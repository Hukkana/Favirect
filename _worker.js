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
function renderAccordion(items, origin, kind) {
  const title = kind === 'public' ? '公開リダイレクト一覧' : '<b>非</b>公開リダイレクト一覧';
  return `<details class="accordion" id="${kind}-links"><summary><h2>${title}</h2><span class="summary-meta"><span class="count">${items.length}<span class="sr-only">件</span></span><svg class="accordion-arrow" width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></summary><div class="list">${renderItems(items,origin)}</div></details>`;
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
  const body = `<header class="logo-container"><img src="${DEFAULT_ICON}" alt="" class="logo-img"><div><h1 class="brand-name">Favirect</h1><p class="brand-description">自分だけのショートカット</p></div></header>
<div id="feedback" role="${error ? 'alert' : 'status'}" class="feedback ${error ? 'error' : ''}" ${notice ? '' : 'hidden'}>${h(notice)}</div>
<section id="editor" class="editor" aria-labelledby="editor-title"><h2 id="editor-title">${editing ? 'リンクを編集' : '新しいリンクを追加'}</h2>
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
</form></section>
<div class="redirect-lists">
${renderAccordion(results.filter(x => x.is_public == null || x.is_public === 1),url.origin,'public')}
${renderAccordion(results.filter(x => x.is_public != null && x.is_public !== 1),url.origin,'private')}
</div>
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
// WCAG-informed contrast, touch targets and reduced-motion support.
// Spring timing is a visual design choice, not a claim of measured UX performance.
const CSS = `
:root{--paper:#fcfeff;--ink:#0f172a;--muted:#475569;--brand:#38aefc;--link:#105f91;--accent:#ffa200;--line:#cbd5e1;--off:#dbdbdb;--spring:cubic-bezier(.22,1.35,.36,1)}
*{box-sizing:border-box}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans JP",sans-serif;color:var(--ink);background-color:#fcfeff;background-image:radial-gradient(circle,#dae4e6 2px,transparent 2px);background-position:0 0;background-size:34px 34px;line-height:1.7;padding:48px 24px 64px;-webkit-text-size-adjust:100%}
.container{max-width:600px;margin:0 auto}
button,input{font:inherit}
button,a,input,summary{-webkit-tap-highlight-color:transparent}
button,a,summary{touch-action:manipulation}
a{color:var(--link);text-underline-offset:4px}
button{cursor:pointer}
button:focus-visible,a:focus-visible,summary:focus-visible,input:focus-visible{outline:3px solid var(--link);outline-offset:4px}
h1{font-size:24px;overflow-wrap:anywhere;line-height:1.45}
h2{font-size:17px;font-weight:700;letter-spacing:.01em;line-height:1.5;margin:0;color:var(--ink)}
h3{font-size:16px;font-weight:650;margin:0;overflow-wrap:anywhere;line-height:1.6}
.logo-container{display:flex;align-items:center;gap:14px;margin-bottom:40px}
.logo-img{width:48px;height:48px;object-fit:contain;display:block}
.brand-name{font-size:26px;font-weight:750;letter-spacing:-.035em;margin:0;line-height:1.25}
.brand-description{font-size:12px;color:var(--muted);margin:4px 0 0}
.editor{scroll-margin-top:24px}
.editor>h2{display:flex;align-items:center;gap:10px;padding-bottom:16px;border-bottom:1px solid var(--line)}
.editor>h2:before{content:"";width:4px;height:18px;background:var(--brand);flex-shrink:0}
#link-form{padding-top:24px}
.form-group{margin-bottom:22px}
.form-group>label{display:block;font-size:13px;font-weight:650;margin-bottom:4px;color:#334155}
input[type=text],input[type=url],input[type=file]{display:block;width:100%;min-width:0;min-height:48px;padding:12px 0;color:var(--ink);font-size:16px;border:0;border-bottom:1px solid #64748b;background:transparent;border-radius:0;transition:border-color .16s ease}
input::placeholder{color:#526174;opacity:1}
input[readonly]{color:var(--muted)}
input:focus{border-bottom-color:var(--link)}
input[type=file]{font-size:14px;overflow:hidden;padding:8px 0}
input[type=file]::file-selector-button{font:inherit;color:var(--link);background:#e6f4fe;border:0;border-radius:4px;min-height:44px;padding:8px 12px;margin-right:12px;cursor:pointer}
.muted{color:var(--muted)}
.hint{font-size:12px;margin:8px 0;line-height:1.8}
.remove-row{display:flex;gap:10px;align-items:center;min-height:44px;font-size:14px}
.remove-row input{width:20px;height:20px;accent-color:var(--link)}
.preview{display:flex;gap:16px;align-items:center;padding:20px 0;border-bottom:1px solid var(--line);margin-bottom:12px}
.preview img{width:56px;height:56px;object-fit:cover;border-radius:10px;flex-shrink:0}
.preview>div{min-width:0}
.preview p{margin:2px 0 0;font-weight:650;font-size:16px;overflow-wrap:anywhere}
.switch-row{display:flex;align-items:center;gap:12px;position:relative;min-height:48px;cursor:pointer;font-size:14px;font-weight:600}
.switch-row input{position:absolute;opacity:0;width:44px;height:44px;margin:0}
.track{width:40px;height:22px;display:inline-block;position:relative;background:var(--off);border:1px solid #64748b;border-radius:22px;flex-shrink:0;transition:background-color .16s ease}
.track>span{position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:#fff;border:1px solid #64748b;transition:transform .18s ease}
.checked,input:checked+.track{background:var(--brand);border-color:var(--link)}
.checked>span,input:checked+.track>span{transform:translateX(18px);border-color:var(--link)}
.switch-row input:focus-visible+.track{outline:3px solid var(--link);outline-offset:4px}
.submit-btn{width:100%;padding:14px 20px;margin-top:24px;border:0;border-radius:6px;background:var(--brand);color:var(--ink);font-weight:700;font-size:15px;min-height:52px;transition:background-color .16s ease}
.submit-btn:hover{background:#62bfff}
.cancel{display:block;text-align:center;padding:12px;min-height:48px}
.redirect-lists{margin-top:40px}
.accordion{margin:0}
.accordion>summary{display:flex;align-items:center;justify-content:space-between;gap:16px;cursor:pointer;list-style:none;min-height:64px;padding:16px 0;border-bottom:1px solid var(--line);user-select:none}
.accordion>summary::-webkit-details-marker{display:none}
.accordion>summary::marker{content:""}
.accordion>summary h2{font-size:15px;flex:1;min-width:0}
.accordion b{font-weight:900}
.summary-meta{display:flex;gap:12px;align-items:center;flex-shrink:0}
.count{font-size:12px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--muted)}
.accordion-arrow{display:block;color:var(--link);transform:rotate(-90deg);transform-origin:50% 50%;transition:transform 320ms var(--spring)}
.accordion[open]>summary .accordion-arrow{transform:rotate(0deg)}
.accordion>summary:hover h2{color:var(--link)}
.accordion[open]>summary{border-bottom-color:var(--brand)}
.item{padding:24px 0 20px;border-bottom:1px solid var(--line)}
.item-header{display:flex;align-items:center;gap:12px}
.item-icon{width:36px;height:36px;object-fit:cover;border-radius:7px;flex-shrink:0}
.item-meta{min-width:0}
.item-id{font-size:12px;overflow-wrap:anywhere}
.item-url{font-size:13px;color:var(--muted);overflow-wrap:anywhere;margin:10px 0 8px;padding-left:48px}
.item-controls{padding-left:48px}
.states,.item-actions{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.inline-form{margin:0}
.state-button{display:flex;align-items:center;gap:10px;min-width:88px;min-height:44px;border:0;background:transparent;padding:0;color:#334155;font-size:13px}
.item-actions{gap:8px;margin:4px -8px 0}
.item-actions a,.item-actions button{display:inline-flex;align-items:center;justify-content:center;min-width:44px;min-height:44px;padding:8px;border:0;border-radius:4px;background:transparent;font-size:13px;color:var(--link);text-decoration:none;font-weight:600}
.item-actions .delete-btn{color:#b42318}
.item-actions a:hover,.item-actions button:hover{background:#e6f4fe;text-decoration:underline}
.feedback{padding:12px 0;border-bottom:1px solid var(--line);margin-bottom:24px;font-size:14px;overflow-wrap:anywhere}
.error{color:#b42318}
.empty{font-size:14px;padding:16px 0;margin:0;border-bottom:1px solid var(--line)}
.privacy-note{margin-top:16px}
.notice-box{padding:20px 0 32px;border-bottom:1px solid var(--line)}
.badge{display:inline-block;background:var(--accent);color:var(--ink);font-size:12px;font-weight:700;padding:4px 10px;border-radius:3px}
.message-body{white-space:pre-line;font-size:15px}
.domain-highlight{color:var(--ink);font-weight:700;text-decoration:underline;text-decoration-color:var(--accent);text-decoration-thickness:3px;text-underline-offset:4px}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap;border:0}
[hidden]{display:none!important}
@media(max-width:420px){body{padding:28px 20px 48px}.logo-container{margin-bottom:32px}.item-controls,.item-url{padding-left:0}.item-actions{gap:8px}.accordion>summary{gap:8px}.summary-meta{gap:8px}}
@media(prefers-reduced-motion:reduce){*,*::before,*::after{transition:none!important;animation:none!important;scroll-behavior:auto!important}}
`;
const CLIENT = String.raw`
(() => {
  // Remember each list independently through POST redirects; storage is optional.
  document.querySelectorAll('details.accordion').forEach(details => {
    const key = 'favirect:accordion:' + details.id;
    try { details.open = sessionStorage.getItem(key) === 'open'; } catch {}
    details.addEventListener('toggle', () => {
      try { sessionStorage.setItem(key, details.open ? 'open' : 'closed'); } catch {}
    });
  });
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
