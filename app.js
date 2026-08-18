'use strict';
let medicines = [], meta = {}, shown = 30, hasSearched = false;
const $ = (s) => document.querySelector(s);
const normalize = (v) => String(v || '').normalize('NFKC').toLowerCase().replace(/[\s・･―ー‐\-（）()「」『』【】\[\]]/g, '');
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function filteredMedicines() {
  const query = normalize($('#q').value), route = $('#route').value, changeOnly = $('#changeOnly').checked;
  return medicines.filter(m => {
    const haystack = normalize([m.name,m.ingredient,m.company,m.spec].join(' '));
    return (!route || m.route === route) && (!changeOnly || m.change_listed) && (!query || haystack.includes(query));
  });
}
function resultCard(m) {
  const price = m.price == null ? '' : `<dt>薬価</dt><dd>${Number(m.price).toLocaleString('ja-JP')}円</dd>`;
  return `<article class="medicine"><h3>${escapeHtml(m.name)}</h3><div class="badges"><span class="badge">✓ 基礎的医薬品</span><span class="badge ${m.change_listed?'listed':'not-listed'}">基礎的リスト：${m.change_listed?'掲載あり':'掲載なし'}</span></div><dl><dt>区分</dt><dd>${escapeHtml(m.route||'—')}</dd><dt>成分名</dt><dd>${escapeHtml(m.ingredient||'—')}</dd><dt>規格</dt><dd>${escapeHtml(m.spec||'—')}</dd><dt>メーカー</dt><dd>${escapeHtml(m.company||'—')}</dd><dt>選定区分</dt><dd>${escapeHtml(m.category||'—')}</dd>${price}</dl></article>`;
}
function render() {
  const results = $('#results'); results.setAttribute('aria-busy','false');
  if (!hasSearched) { $('#status').textContent = `収録 ${medicines.length.toLocaleString('ja-JP')}件`; results.innerHTML='<div class="start-message"><strong>薬の名前などを入力して「検索する」を押してください。</strong><br>入力途中で結果が動かないので、落ち着いて検索できます。</div>'; return; }
  const all = filteredMedicines(); $('#status').textContent=`${all.length.toLocaleString('ja-JP')}件見つかりました（収録 ${medicines.length.toLocaleString('ja-JP')}件）`;
  if (!all.length) { results.innerHTML='<div class="empty"><strong>該当するお薬が見つかりませんでした。</strong><br>商品名の一部・成分名・メーカー名・規格でも試してください。</div>'; return; }
  results.innerHTML=all.slice(0,shown).map(resultCard).join('')+(all.length>shown?'<button class="more" id="more" type="button">さらに表示</button>':'');
  $('#more')?.addEventListener('click',()=>{shown+=30;render();});
}
function formatDate(v, dateOnly=false) { if(!v)return'不明'; const d=new Date(v); if(Number.isNaN(d.getTime()))return escapeHtml(v); return dateOnly?d.toLocaleDateString('ja-JP',{year:'numeric',month:'long',day:'numeric'}):d.toLocaleString('ja-JP'); }
async function loadJson(url){const r=await fetch(url,{cache:'no-store'});if(!r.ok)throw new Error(`${url}: ${r.status}`);return r.json();}
async function init(){try{
  [medicines,meta]=await Promise.all([loadJson('data/medicines.json'),loadJson('data/meta.json')]);
  const ok=meta.status==='normal'; $('#healthDot').classList.add(ok?'ok':'warn'); $('#latestCard').classList.add(ok?'is-latest':'is-warning');
  const applicable=formatDate(meta.applicable_date,true), generated=formatDate(meta.generated_at);
  $('#latestTitle').textContent=ok?`✓ 最新版｜${meta.dataset_title||'基礎的医薬品対象品目リスト'}`:'更新状況を確認中';
  $('#latestMeta').textContent=`適用：${applicable} ／ 最終データ更新：${generated} ／ 収録 ${medicines.length.toLocaleString('ja-JP')}件`;
  $('#source').innerHTML=`対象資料：${escapeHtml(meta.dataset_title||'基礎的医薬品対象品目リスト')}<br>適用：${applicable}　データ生成：${generated}<br><a href="${escapeHtml(meta.source_page_url)}" target="_blank" rel="noopener noreferrer">厚生労働省の公式資料を確認する</a>`;
  if(!ok){const n=$('#notice');n.classList.remove('hidden');n.textContent='更新状況を確認中です。現在は、直前に正常取得できたデータを表示しています。最終判断は公式資料で確認してください。';}
  render();
}catch(e){console.error(e);$('#healthDot').classList.add('warn');$('#latestTitle').textContent='データの読み込み状況を確認してください';$('#status').textContent='データを読み込めませんでした。';$('#results').innerHTML='<div class="empty">読み込みに失敗しました。時間をおいて再度お試しください。</div>';}}
$('#searchForm').addEventListener('submit',e=>{e.preventDefault();hasSearched=true;shown=30;render();$('#results').scrollIntoView({behavior:'smooth',block:'start'});});
['route','changeOnly'].forEach(id=>$('#'+id).addEventListener('change',()=>{if(hasSearched){shown=30;render();}}));
$('#q').addEventListener('keydown',e=>{if(e.key==='Escape')$('#clear').click();});
$('#clear').addEventListener('click',()=>{$('#q').value='';hasSearched=false;shown=30;render();$('#q').focus();});
const dialog=$('#helpDialog');$('#showHelp').addEventListener('click',()=>dialog.showModal());$('#closeHelp').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',e=>{if(e.target===dialog)dialog.close();});
init();
