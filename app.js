'use strict';
let medicines = [];
let meta = {};
let shown = 30;
const $ = (selector) => document.querySelector(selector);
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s・･―ー‐\-（）()「」『』【】\[\]]/g, '');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function filteredMedicines() {
  const query = normalize($('#q').value);
  const route = $('#route').value;
  const changeOnly = $('#changeOnly').checked;
  return medicines.filter((medicine) => {
    const haystack = normalize([medicine.name, medicine.ingredient, medicine.company, medicine.spec].join(' '));
    return (!route || medicine.route === route) && (!changeOnly || medicine.change_listed) && (!query || haystack.includes(query));
  });
}

function resultCard(medicine) {
  const price = medicine.price == null ? '' : `<dt>薬価</dt><dd>${Number(medicine.price).toLocaleString('ja-JP')}円</dd>`;
  return `<article class="medicine">
    <h3>${escapeHtml(medicine.name)}</h3>
    <div class="badges">
      <span class="badge">✓ 基礎的医薬品</span>
      <span class="badge ${medicine.change_listed ? 'listed' : 'not-listed'}">基礎的リスト：${medicine.change_listed ? '掲載あり' : '掲載なし'}</span>
    </div>
    <dl>
      <dt>区分</dt><dd>${escapeHtml(medicine.route || '—')}</dd>
      <dt>成分名</dt><dd>${escapeHtml(medicine.ingredient || '—')}</dd>
      <dt>規格</dt><dd>${escapeHtml(medicine.spec || '—')}</dd>
      <dt>メーカー</dt><dd>${escapeHtml(medicine.company || '—')}</dd>
      <dt>選定区分</dt><dd>${escapeHtml(medicine.category || '—')}</dd>
      ${price}
    </dl>
  </article>`;
}

function render() {
  const all = filteredMedicines();
  $('#status').textContent = `${all.length.toLocaleString('ja-JP')}件見つかりました（収録 ${medicines.length.toLocaleString('ja-JP')}件）`;
  const results = $('#results');
  results.setAttribute('aria-busy', 'false');
  if (!all.length) {
    results.innerHTML = '<div class="empty">該当するお薬が見つかりませんでした。<br>商品名の一部・成分名・メーカー名でも試してください。</div>';
    return;
  }
  results.innerHTML = all.slice(0, shown).map(resultCard).join('') + (all.length > shown ? '<button class="more" id="more" type="button">さらに表示</button>' : '');
  $('#more')?.addEventListener('click', () => { shown += 30; render(); });
}

function formatDate(value) {
  if (!value) return '不明';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? escapeHtml(value) : date.toLocaleString('ja-JP');
}

async function loadJson(url) {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function init() {
  try {
    [medicines, meta] = await Promise.all([loadJson('data/medicines.json'), loadJson('data/meta.json')]);
    $('#healthDot').classList.add(meta.status === 'normal' ? 'ok' : 'warn');
    $('#source').innerHTML = `対象資料：${escapeHtml(meta.dataset_title || '基礎的医薬品対象品目リスト')}<br>データ生成：${formatDate(meta.generated_at)}<br><a href="${escapeHtml(meta.source_page_url)}" target="_blank" rel="noopener noreferrer">厚生労働省の公式資料を確認する</a>`;
    if (meta.status !== 'normal') {
      const notice = $('#notice');
      notice.classList.remove('hidden');
      notice.textContent = '更新状況を確認中です。現在は、直前に正常取得できたデータを表示しています。最終判断は公式資料で確認してください。';
    }
    render();
  } catch (error) {
    console.error(error);
    $('#healthDot').classList.add('warn');
    $('#status').textContent = 'データを読み込めませんでした。';
    $('#results').setAttribute('aria-busy', 'false');
    $('#results').innerHTML = '<div class="empty">読み込みに失敗しました。時間をおいて再度お試しください。<br>急ぎの場合は厚生労働省の公式資料をご確認ください。</div>';
  }
}

['q', 'route', 'changeOnly'].forEach((id) => {
  const eventName = id === 'q' ? 'input' : 'change';
  $('#' + id).addEventListener(eventName, () => { shown = 30; render(); });
});
$('#q').addEventListener('keydown', (event) => { if (event.key === 'Escape') $('#clear').click(); });
$('#clear').addEventListener('click', () => { $('#q').value = ''; shown = 30; render(); $('#q').focus(); });
const dialog = $('#helpDialog');
$('#showHelp').addEventListener('click', () => dialog.showModal());
$('#closeHelp').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
init();
