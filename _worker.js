// Favirect — replacement Worker (existing links schema / env.DB).
// Authentication is NOT included. is_public remains a dashboard grouping flag.
// Requires the existing is_public column; schema changes are not run per request.
const DEFAULT_ICON = 'https://hukkana.github.io/Favirect/Favirect-icon.png';
const MAX_IMAGE = 512 * 1024;
const MAX_BODY = 2 * 1024 * 1024;
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const h = escapeHtml;
const linkPath = id => '/' + encodeURIComponent(id);
class InputError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }
function webUrl(value, label) {
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error();
    return parsed.href;
  } catch { throw new InputError(label + 'は http:// または https:// で始まるURLを入力してください。'); }
}
function safeIcon(value) {
  if (!value) return DEFAULT_ICON;
  if (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  try { return webUrl(value, '画像URL'); } catch { return DEFAULT_ICON; }
}
async function getLink(db, id) {
  const { results } = await db.prepare('SELECT * FROM links WHERE id = ?').bind(id).all();
  return results?.[0];
}
function redirect(path) { return new Response(null, {status:303, headers:{Location:path, 'Cache-Control':'no-store'}}); }
function page(title, body, {status = 200, icon = DEFAULT_ICON, script = false} = {}) {
  return new Response(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${h(title)}</title><meta name="apple-mobile-web-app-title" content="${h(title)}"><link rel="icon" href="${h(icon)}"><link rel="apple-touch-icon" href="${h(icon)}"><style>${CSS}</style></head><body><main class="container">${body}</main>${script ? '<script>' + CLIENT + '</script>' : ''}</body></html>`, {
    status, headers:{'Content-Type':'text/html;charset=UTF-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'}
  });
}
const hidden = (name, value) => `<input type="hidden" name="${h(name)}" value="${h(value)}">`;
function actionForm(action, id, content, extra = '') {
  return `<form method="POST" action="/" class="inline-form"${action === 'delete' ? ' data-delete' : ''}>${hidden('action', action)}${hidden('id', id)}${extra}${content}</form>`;
}
function stateButton(link, field, label) {
  const on = field === 'is_public' ? link[field] == null || link[field] === 1 : link[field] === 1;
  return actionForm('set_state', link.id, `<button type="submit" role="switch" aria-checked="${on}" aria-label="${h(link.title || link.id)}：${label}" class="state-button"><span>${label}</span><span class="track ${on ? 'checked' : ''}" aria-hidden="true"><span></span></span></button>`, hidden('field', field) + hidden('value', on ? '0' : '1'));
}
function renderItems(items, origin) {
  if (!items.length) return '<p class="muted empty">該当するリンクはありません。</p>';
  return items.map(link => `<article class="item"><div class="item-header"><img class="item-icon" src="${h(safeIcon(link.icon_url))}" alt="" loading="lazy"><div class="item-meta"><h3>${h(link.title || link.id)}</h3><span class="muted item-id">/${h(link.id)}</span></div></div><div class="item-url">${h(link.target_url)}</div><div class="item-controls"><div class="states">${stateButton(link,'is_active','転送')}${stateButton(link,'is_public','公開')}</div><div class="item-actions"><a href="/?edit=${h(encodeURIComponent(link.id))}#editor">編集</a><button type="button" data-copy="${h(origin + linkPath(link.id))}">URLコピー</button><a href="${h(linkPath(link.id))}" target="_blank" rel="noopener">開く</a>${actionForm('delete',link.id,'<button class="delete-btn" type="submit">削除</button>')}</div></div></article>`).join('');
}
function checkbox(name, label, checked) {
  return `<label class="switch-row"><input type="checkbox" id="${name}" name="${name}" value="1" ${checked ? 'checked' : ''}><span class="track" aria-hidden="true"><span></span></span><span>${label}</span></label>`;
}
async function dashboard(db, url, {values, editing = false, error = '', status = 200} = {}) {
  const {results = []} = await db.prepare('SELECT * FROM links ORDER BY rowid DESC').all();
  if (!values && url.searchParams.has('edit')) {
    values = results.find(row => row.id === url.searchParams.get('edit'));
    if (!values) return page('見つかりません', '<h1>リンクが見つかりません。</h1><a href="/">一覧に戻る</a>', {status:404});
    editing = true;
  }
  const v = values || {id:'',target_url:'',title:'',icon_url:'',is_active:1,is_public:1};
  const currentIcon = editing ? results.find(row => row.id === v.id)?.icon_url || '' : '';
  const previewIcon = v.icon_url || currentIcon;
  const externalIcon = /^https?:\/\//i.test(v.icon_url || '') ? v.icon_url : '';
  const messages = {saved:'保存しました。',updated:'変更を保存しました。',deleted:'削除しました。',changed:'設定を変更しました。',enabled:'転送を有効にしました。'};
  const notice = error || messages[url.searchParams.get('notice')] || '';
  const body = `<header class="logo-container"><img src="${DEFAULT_ICON}" alt="Favirect" class="logo-img"></header>
<div id="feedback" role="${error ? 'alert' : 'status'}" class="feedback ${error ? 'error' : ''}" ${notice ? '' : 'hidden'}>${h(notice)}</div>
<details id="editor" class="editor" ${editing || error || !results.length ? 'open' : ''}><summary>${editing ? 'リンクを編集' : '新しいリンクを追加'}</summary>
<form method="POST" action="/" enctype="multipart/form-data" id="link-form">
${hidden('action',editing ? 'update' : 'create')}
<div class="form-group"><label for="id">識別ID${editing ? '（変更できません）' : '（半角英数字・ハイフン・アンダーバー）'}</label><input type="text" id="id" name="id" value="${h(v.id)}" ${editing ? 'readonly' : 'pattern="[A-Za-z0-9_-]{1,64}" maxlength="64"'} placeholder="myapp" required></div>
<div class="form-group"><label for="target_url">転送先URL</label><input type="url" id="target_url" name="target_url" value="${h(v.target_url)}" maxlength="4096" placeholder="https://example.com" required></div>
<div class="form-group"><label for="title">タイトル</label><input type="text" id="title" name="title" value="${h(v.title)}" maxlength="100" placeholder="アプリ名など"></div>
<div class="form-group"><label for="icon_file">アイコン画像ファイル</label><input type="file" id="icon_file" name="icon_file" accept="image/png,image/jpeg,image/gif,image/webp"><p class="muted hint">PNG・JPEG・GIF・WebP／512KBまで。ファイルを選ぶと画像URLより優先されます。</p></div>
<div class="form-group"><label for="icon_url">アイコン画像URL</label><input type="url" id="icon_url" name="icon_url" value="${h(externalIcon)}" maxlength="4096" placeholder="https://example.com/icon.png"></div>
${editing ? '<p class="muted hint">新しい画像を指定しなければ、現在のアイコンを保持します。</p><label class="remove-row"><input type="checkbox" id="remove_icon" name="remove_icon" value="1">現在のアイコンを削除する</label>' : ''}
<div class="preview"><img id="preview-icon" src="${h(safeIcon(previewIcon))}" data-current="${h(safeIcon(previewIcon))}" data-default="${DEFAULT_ICON}" alt=""><div><span class="muted hint">プレビュー</span><p id="preview-title">${h(v.title || v.id || 'アプリ名')}</p><span id="preview-error" class="muted hint" role="status"></span></div></div>
${checkbox('is_active','転送を有効にする',v.is_active === 1)}${checkbox('is_public','公開リダイレクトにする',v.is_public == null || v.is_public === 1)}
<button class="submit-btn" type="submit">${editing ? '変更を保存する' : '保存する'}</button>${editing ? '<a class="cancel" href="/">編集をキャンセル</a>' : ''}
</form></details>
<h2>公開リダイレクト一覧</h2><div class="list">${renderItems(results.filter(x => x.is_public == null || x.is_public === 1),url.origin)}</div>
<details class="accordion"><summary><span><b>非</b>公開リダイレクト一覧</span></summary><div class="list">${renderItems(results.filter(x => x.is_public != null && x.is_public !== 1),url.origin)}</div></details>
<p class="muted hint privacy-note">「非公開」は一覧の分類です。アクセス制限はありません。</p>`;
  return page('Favirect Dashboard',body,{status,script:true});
}
async function limitedForm(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) throw new InputError('送信データが大きすぎます。画像を小さくしてください。',413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError('送信内容がありません。');
  const chunks = []; let total = 0;
  for (;;) {
    const {done,value} = await reader.read(); if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY) { await reader.cancel(); throw new InputError('送信データが大きすぎます。画像を小さくしてください。',413); }
    chunks.push(value);
  }
  try { return await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('content-type') || ''}}).formData(); }
  catch { throw new InputError('フォームの形式が正しくありません。'); }
}
async function uploadedIcon(file) {
  if (file.size > MAX_IMAGE) throw new InputError('画像は512KB以下にしてください。');
  const b = new Uint8Array(await file.arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...b.slice(start,end));
  let mime = '';
  if (b.length >= 8 && [137,80,78,71,13,10,26,10].every((x,i) => b[i] === x)) mime = 'image/png';
  else if (b[0] === 255 && b[1] === 216 && b[2] === 255) mime = 'image/jpeg';
  else if (['GIF87a','GIF89a'].includes(ascii(0,6))) mime = 'image/gif';
  else if (ascii(0,4) === 'RIFF' && ascii(8,12) === 'WEBP') mime = 'image/webp';
  if (!mime) throw new InputError('PNG・JPEG・GIF・WebPの画像を選んでください。');
  let binary = '';
  for (let i = 0; i < b.length; i += 8192) binary += String.fromCharCode(...b.subarray(i,i + 8192));
  return `data:${mime};base64,${btoa(binary)}`;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (!['GET','HEAD','POST'].includes(request.method)) return new Response('Method Not Allowed',{status:405,headers:{Allow:'GET, HEAD, POST'}});
      if (request.method === 'POST') {
        if (url.pathname !== '/') return page('見つかりません','<h1>ページが見つかりません。</h1>',{status:404});
        // Same-origin browser submissions only. This is not administrator authentication.
        if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site') === 'cross-site') return page('操作できません','<h1>この画面から送信し直してください。</h1><a href="/">一覧に戻る</a>',{status:403});
        const form = await limitedForm(request);
        const str = name => { const value = form.get(name); if (value != null && typeof value !== 'string') throw new InputError('入力形式が正しくありません。'); return value || ''; };
        const action = str('action'); const id = str('id');
        if (['create','update'].includes(action)) {
          const editing = action === 'update';
          const old = editing ? await getLink(env.DB,id) : null;
          if (editing && !old) return page('見つかりません','<h1>編集するリンクが見つかりません。</h1><a href="/">一覧に戻る</a>',{status:404});
          const values = {id,target_url:str('target_url').trim(),title:str('title').trim(),icon_url:str('icon_url').trim(),is_active:form.has('is_active') ? 1 : 0,is_public:form.has('is_public') ? 1 : 0};
          try {
            if (!editing && !/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new InputError('識別IDは半角英数字・ハイフン・アンダーバーの1〜64文字にしてください。');
            if (values.title.length > 100 || values.target_url.length > 4096 || values.icon_url.length > 4096) throw new InputError('タイトルは100文字、URLは4096文字以内にしてください。');
            const target = webUrl(values.target_url,'転送先URL');
            let icon = old?.icon_url || '';
            const file = form.get('icon_file');
            const hasFile = file && typeof file === 'object' && file.size > 0;
            if (form.has('remove_icon') && (hasFile || values.icon_url)) throw new InputError('アイコンを削除する場合は、画像ファイルと画像URLを空にしてください。');
            if (form.has('remove_icon')) icon = '';
            else if (hasFile) icon = await uploadedIcon(file);
            else if (values.icon_url) icon = webUrl(values.icon_url,'画像URL');
            const title = values.title || id;
            let result;
            if (editing) result = await env.DB.prepare('UPDATE links SET target_url = ?, title = ?, icon_url = ?, is_active = ?, is_public = ? WHERE id = ?').bind(target,title,icon,values.is_active,values.is_public,id).run();
            else result = await env.DB.prepare('INSERT INTO links (id, target_url, title, icon_url, is_active, is_public) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO NOTHING').bind(id,target,title,icon,values.is_active,values.is_public).run();
            if (!result.meta?.changes) throw new InputError(editing ? 'リンクが削除されたため保存できませんでした。' : 'この識別IDは登録済みです。一覧の「編集」から変更してください。',409);
            return redirect('/?notice=' + (editing ? 'updated' : 'saved'));
          } catch (error) {
            if (!(error instanceof InputError)) console.error('Favirect save failed',error);
            // Uploaded files cannot be repopulated by browsers after an error.
            return await dashboard(env.DB,url,{values,editing,error:(error instanceof InputError ? error.message : '保存できませんでした。入力内容を確認して再度お試しください。') + (form.get('icon_file')?.size ? ' 画像ファイルは選び直してください。' : ''),status:error instanceof InputError ? error.status : 500});
          }
        }
        if (!['set_state','enable','delete'].includes(action) || !id) throw new InputError('操作が正しくありません。');
        let result;
        if (action === 'delete') result = await env.DB.prepare('DELETE FROM links WHERE id = ?').bind(id).run();
        else {
          const field = action === 'enable' ? 'is_active' : str('field');
          const value = action === 'enable' ? '1' : str('value');
          if (!['is_active','is_public'].includes(field) || !['0','1'].includes(value)) throw new InputError('設定値が正しくありません。');
          result = await env.DB.prepare(`UPDATE links SET ${field} = ? WHERE id = ?`).bind(Number(value),id).run();
        }
        if (!result.meta?.changes) throw new InputError('リンクが見つかりません。',404);
        return redirect('/?notice=' + (action === 'delete' ? 'deleted' : action === 'enable' ? 'enabled' : 'changed'));
      }
      let response;
      if (url.pathname !== '/') {
        let id;
        try { id = decodeURIComponent(url.pathname.slice(1)); } catch { throw new InputError('URLが正しくありません。'); }
        const link = await getLink(env.DB,id);
        if (!link) response = page('見つかりません','<h1>リンクが見つかりません。</h1><a href="/">一覧に戻る</a>',{status:404});
        else if (link.is_active === 1) response = new Response(null,{status:302,headers:{Location:webUrl(link.target_url,'登録済みの転送先URL'),'Cache-Control':'no-store'}});
        else {
          let domain = link.target_url; try { domain = new URL(domain).hostname; } catch {}
          response = page(link.title || link.id,`<section class="notice-box"><span class="badge">一時的に無効</span><h1>${h(link.title || link.id)}</h1><p class="message-body">今のうちにホーム画面に追加しておいてね。
<span class="domain-highlight">${h(domain)}</span> への転送は一時的に無効になっています。

もし有効に変更したいなら以下のボタンを押してください。</p>${actionForm('enable',link.id,'<button class="submit-btn" type="submit">転送を有効にする</button>')}</section>`,{icon:safeIcon(link.icon_url)});
        }
      } else if (url.searchParams.has('action')) response = page('操作方法が変わりました','<h1>一覧のボタンから操作してください。</h1><p>リンクを開くだけでは設定の変更や削除は行いません。</p><a href="/">一覧に戻る</a>',{status:405});
      else response = await dashboard(env.DB,url);
      return request.method === 'HEAD' ? new Response(null,{status:response.status,headers:response.headers}) : response;
    } catch (error) {
      if (!(error instanceof InputError)) console.error('Favirect request failed',error);
      return page('Favirect',`<h1>処理できませんでした。</h1><p>${h(error instanceof InputError ? error.message : 'データの読み込みに失敗しました。再度お試しください。')}</p><a href="/">一覧に戻る</a>`,{status:error instanceof InputError ? error.status : 500});
    }
  }
};
const CSS = `
*{box-sizing:border-box}body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;color:#0f172a;background-color:#fcfeff;background-image:radial-gradient(circle,#dae4e6 2px,transparent 2px);background-position:0 0;background-size:34px 34px;line-height:1.7;padding:48px 20px}.container{max-width:560px;margin:0 auto}button,input{font:inherit}button,a,input,summary{-webkit-tap-highlight-color:transparent}button,a{touch-action:manipulation}a{color:#126ba0}button{cursor:pointer}button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:3px solid #126ba0;outline-offset:4px}h1{font-size:22px;overflow-wrap:anywhere}h2{font-size:15px;color:#38aefc;margin:36px 0 0;padding-bottom:10px;border-bottom:1px solid #cbd5e1}h3{font-size:16px;margin:0;overflow-wrap:anywhere}.logo-container{margin-bottom:28px}.logo-img{max-width:180px;height:auto;display:block}.editor>summary,.accordion>summary{cursor:pointer;font-weight:700;padding:14px 0;min-height:48px}.editor>summary{color:#126ba0;border-bottom:1px solid #cbd5e1}.accordion{margin-top:24px}.accordion>summary{color:#38aefc;border-bottom:1px solid #cbd5e1}.accordion b{font-weight:900;color:#0f172a}#link-form{padding-top:20px}.form-group{margin-bottom:20px}.form-group>label{display:block;font-size:13px;font-weight:600;margin-bottom:6px}input[type=text],input[type=url],input[type=file]{width:100%;min-height:48px;padding:12px 0;color:#0f172a;font-size:16px;border:0;border-bottom:1px solid #cbd5e1;background:transparent;border-radius:0}input[readonly]{color:#64748b}input:focus{border-bottom-color:#38aefc}.muted{color:#526174}.hint{font-size:12px;margin:6px 0}.remove-row{display:flex;gap:8px;align-items:center;min-height:44px;font-size:14px}.preview{display:flex;gap:14px;align-items:center;padding:20px 0;border-bottom:1px solid #cbd5e1;margin-bottom:12px}.preview img{width:56px;height:56px;object-fit:cover;border-radius:12px}.preview>div{min-width:0}.preview p{margin:0;font-weight:700;overflow-wrap:anywhere}.switch-row{display:flex;align-items:center;gap:12px;position:relative;min-height:48px;cursor:pointer;font-size:14px;font-weight:600}.switch-row input{position:absolute;opacity:0;width:44px;height:44px;margin:0}.track{width:38px;height:20px;display:inline-block;position:relative;background:#dbdbdb;border-radius:20px;flex-shrink:0}.track>span{position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#fff;transition:transform .15s}.checked,input:checked+.track{background:#38aefc}.checked>span,input:checked+.track>span{transform:translateX(18px)}.switch-row input:focus-visible+.track{outline:3px solid #126ba0;outline-offset:4px}.submit-btn{width:100%;padding:14px;margin-top:20px;border:0;border-radius:6px;background:#38aefc;color:#0f172a;font-weight:700;min-height:48px}.submit-btn:hover{background:#62bfff}.cancel{display:block;text-align:center;padding:12px}.item{padding:20px 0;border-bottom:1px solid #cbd5e1}.item-header{display:flex;align-items:center;gap:12px}.item-icon{width:36px;height:36px;object-fit:cover;border-radius:8px;flex-shrink:0}.item-meta{min-width:0}.item-id{font-size:12px;overflow-wrap:anywhere}.item-url{font-size:13px;color:#475569;overflow-wrap:anywhere;margin:8px 0 4px;padding-left:48px}.item-controls{padding-left:48px}.states,.item-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap}.inline-form{margin:0}.state-button{display:flex;align-items:center;gap:8px;min-width:80px;min-height:44px;border:0;background:transparent;padding:0;color:#334155;font-size:13px}.item-actions{gap:14px}.item-actions a,.item-actions button{display:inline-flex;align-items:center;min-height:44px;padding:4px 0;border:0;background:transparent;font-size:13px;color:#126ba0;text-decoration:none;font-weight:600}.item-actions .delete-btn{color:#b42318}.item-actions a:hover,.item-actions button:hover{text-decoration:underline}.feedback{padding:12px 0;border-bottom:1px solid #cbd5e1;margin-bottom:16px;font-size:14px;overflow-wrap:anywhere}.error{color:#b42318}.empty{font-size:14px;padding:16px 0}.privacy-note{margin-top:16px}.notice-box{padding:20px 0 32px;border-bottom:1px solid #cbd5e1}.badge{display:inline-block;background:#ffa200;color:#0f172a;font-size:12px;font-weight:700;padding:4px 10px;border-radius:3px}.message-body{white-space:pre-line;font-size:15px}.domain-highlight{color:#ffa200;font-weight:700}[hidden]{display:none!important}@media(max-width:420px){body{padding:28px 16px}.item-controls,.item-url{padding-left:0}.item-actions{gap:18px}.logo-img{max-width:150px}}@media(prefers-reduced-motion:reduce){*{transition:none!important}}`;
const CLIENT = String.raw`
(() => {
  const form = document.querySelector('#link-form');
  const feedback = document.querySelector('#feedback');
  const notify = text => { feedback.textContent = text; feedback.hidden = false; };
  document.querySelectorAll('[data-delete]').forEach(f => f.addEventListener('submit', e => { if (!confirm('このリンクを削除しますか？')) e.preventDefault(); }));
  document.querySelectorAll('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const value = button.dataset.copy;
    try {
      if (!navigator.clipboard || !window.isSecureContext) throw new Error();
      await navigator.clipboard.writeText(value);
      button.textContent = 'コピーしました'; notify('ショートカットURLをコピーしました。');
    } catch { window.prompt('このURLを選択してコピーしてください。', value); }
  }));
  document.querySelectorAll('.item-icon').forEach(img => img.addEventListener('error', () => { img.hidden = true; }, {once:true}));
  if (!form) return;
  const icon = document.querySelector('#preview-icon');
  const title = document.querySelector('#preview-title');
  const hint = document.querySelector('#preview-error');
  const file = form.elements.icon_file;
  let objectUrl = '';
  function preview() {
    title.textContent = form.elements.title.value.trim() || form.elements.id.value || 'アプリ名';
    hint.textContent = ''; file.setCustomValidity('');
    if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = ''; }
    let src = icon.dataset.current;
    if (form.elements.remove_icon?.checked) src = icon.dataset.default;
    else if (file.files[0]) {
      if (file.files[0].size > 512 * 1024) { file.setCustomValidity('画像は512KB以下にしてください。'); hint.textContent = '画像は512KB以下にしてください。'; }
      else { objectUrl = URL.createObjectURL(file.files[0]); src = objectUrl; }
    } else if (form.elements.icon_url.value.trim()) {
      try { const u = new URL(form.elements.icon_url.value.trim()); if (!['http:','https:'].includes(u.protocol) || u.username || u.password) throw new Error(); src = u.href; }
      catch { hint.textContent = '画像URLを確認してください。'; }
    }
    icon.hidden = false;
    if (icon.getAttribute('src') !== src) icon.src = src;
  }
  icon.addEventListener('error', () => { hint.textContent = '画像を表示できません。URLやファイルを確認してください。'; icon.hidden = true; });
  form.addEventListener('input', preview);
  form.addEventListener('change', preview);
  form.addEventListener('submit', () => { form.querySelector('[type=submit]').textContent = '保存中…'; });
})();`;
