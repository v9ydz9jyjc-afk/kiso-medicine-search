'use strict';

let medicines = [];
let meta = {};
let shown = 30;
let searched = false;
let searchState = { query: '', route: '', listedOnly: false };
let viewMode = 'simple';

const $ = (selector) => document.querySelector(selector);
const normalize = (value) => String(value || '').normalize('NFKC').toLowerCase().replace(/[\s・･―ー‐\-（）()「」『』【】\[\]]/g, '');
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

function filteredMedicines() {
  const query = normalize(searchState.query);
  return medicines.filter((medicine) => {
    const haystack = normalize([medicine.name, medicine.ingredient, medicine.company, medicine.spec].join(' '));
    return (!searchState.route || medicine.route === searchState.route)
      && (!searchState.listedOnly || medicine.change_listed)
      && (!query || haystack.includes(query));
  });
}

function resultCard(medicine) {
  const listedText = medicine.change_listed ? '掲載あり' : '掲載なし';
  const simple = `
    <div class="simple-info">
      <p><span>基礎的リスト</span><strong class="${medicine.change_listed ? 'yes' : 'no'}">${listedText}</strong></p>
      <p class="simple-note">${medicine.change_listed
        ? '厚生労働省の「基礎的リスト」にも掲載されています。'
        : '基礎的医薬品ですが、「基礎的リスト」への掲載は確認されていません。'}</p>
    </div>`;

  const price = medicine.price == null ? '<dt>薬価</dt><dd>—</dd>' : `<dt>薬価</dt><dd>${Number(medicine.price).toLocaleString('ja-JP')}円</dd>`;
  const detail = `
    <div class="badges">
      <span class="badge">✓ 基礎的医薬品</span>
      <span class="badge ${medicine.change_listed ? 'listed' : 'not-listed'}">基礎的リスト：${listedText}</span>
    </div>
    <dl>
      <dt>区分</dt><dd>${escapeHtml(medicine.route || '—')}</dd>
      <dt>成分名</dt><dd>${escapeHtml(medicine.ingredient || '—')}</dd>
      <dt>規格</dt><dd>${escapeHtml(medicine.spec || '—')}</dd>
      <dt>メーカー</dt><dd>${escapeHtml(medicine.company || '—')}</dd>
      <dt>選定区分</dt><dd>${escapeHtml(medicine.category || '—')}</dd>
      ${price}
    </dl>`;

  return `<article class="medicine">
    <h3>${escapeHtml(medicine.name)}</h3>
    ${viewMode === 'simple' ? simple : detail}
  </article>`;
}

function render() {
  const results = $('#results');
  results.setAttribute('aria-busy', 'false');

  if (!searched) {
    $('#status').textContent = `収録 ${medicines.length.toLocaleString('ja-JP')}件。薬品名などを入力して「検索する」を押してください。`;
    results.innerHTML = '<div class="empty start-message">🔎 商品名・成分名・メーカー名・規格から検索できます。</div>';
    return;
  }

  const all = filteredMedicines();
  const scopeText = searchState.listedOnly ? '・基礎的リスト掲載品のみ' : '';
  $('#status').textContent = `${all.length.toLocaleString('ja-JP')}件見つかりました${scopeText}（収録 ${medicines.length.toLocaleString('ja-JP')}件）`;

  if (!all.length) {
    const term = searchState.query ? `「${escapeHtml(searchState.query)}」` : '指定した条件';
    results.innerHTML = `<div class="empty">${term}に該当するお薬が見つかりませんでした。<br>商品名の一部・成分名・メーカー名・規格でも試してください。</div>`;
    return;
  }

  results.innerHTML = all.slice(0, shown).map(resultCard).join('')
    + (all.length > shown ? '<button class="more" id="more" type="button">さらに表示</button>' : '');

  $('#more')?.addEventListener('click', () => {
    shown += 30;
    render();
  });
}

function performSearch() {
  searchState.query = $('#q').value.trim();
  searchState.route = $('#route').value;
  searched = true;
  shown = 30;
  render();
}

function setViewMode(mode) {
  viewMode = mode;
  const simple = mode === 'simple';
  $('#simpleMode').classList.toggle('active', simple);
  $('#detailMode').classList.toggle('active', !simple);
  $('#simpleMode').setAttribute('aria-pressed', String(simple));
  $('#detailMode').setAttribute('aria-pressed', String(!simple));
  if (searched) render();
}

function setScope(listedOnly) {
  searchState.listedOnly = listedOnly;
  $('#allScope').classList.toggle('active', !listedOnly);
  $('#listedScope').classList.toggle('active', listedOnly);
  $('#allScope').setAttribute('aria-pressed', String(!listedOnly));
  $('#listedScope').setAttribute('aria-pressed', String(listedOnly));
  if (searched) {
    shown = 30;
    render();
  }
}

function formatDate(value, dateOnly = false) {
  if (!value) return '不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return dateOnly ? date.toLocaleDateString('ja-JP') : date.toLocaleString('ja-JP');
}

async function loadJson(url) {
  const response = await fetch(url, {cache: 'no-store'});
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.json();
}

async function init() {
  try {
    [medicines, meta] = await Promise.all([
      loadJson('data/medicines.json'),
      loadJson('data/meta.json')
    ]);

    $('#healthDot').classList.add(meta.status === 'normal' ? 'ok' : 'warn');

    $('#latestSummary').textContent = meta.dataset_title || '基礎的医薬品対象品目リスト';
    $('#latestMeta').innerHTML = `
      <span>適用日：${formatDate(meta.applicable_date, true)}</span>
      <span>収録：${Number(meta.target_count || medicines.length).toLocaleString('ja-JP')}件</span>
      <span>データ生成：${formatDate(meta.generated_at)}</span>`;

    $('#source').innerHTML = `対象資料：${escapeHtml(meta.dataset_title || '基礎的医薬品対象品目リスト')}<br>
      データ生成：${formatDate(meta.generated_at)}<br>
      <a href="${escapeHtml(meta.source_page_url)}" target="_blank" rel="noopener noreferrer">厚生労働省の公式資料を確認する</a>`;

    if (meta.status !== 'normal') {
      const notice = $('#notice');
      notice.classList.remove('hidden');
      notice.textContent = '更新状況を確認中です。現在は、直前に正常取得できたデータを表示しています。最終判断は公式資料で確認してください。';
    }

    render();
  } catch (error) {
    console.error(error);
    $('#healthDot').classList.add('warn');
    $('#latestSummary').textContent = 'データ情報を読み込めませんでした。';
    $('#status').textContent = 'データを読み込めませんでした。';
    $('#results').setAttribute('aria-busy', 'false');
    $('#results').innerHTML = '<div class="empty">読み込みに失敗しました。時間をおいて再度お試しください。<br>急ぎの場合は厚生労働省の公式資料をご確認ください。</div>';
  }
}

$('#searchButton').addEventListener('click', performSearch);
$('#q').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') performSearch();
  if (event.key === 'Escape') $('#clear').click();
});
$('#route').addEventListener('change', () => {
  if (searched) performSearch();
});
$('#clear').addEventListener('click', () => {
  $('#q').value = '';
  searched = false;
  shown = 30;
  render();
  $('#q').focus();
});

$('#simpleMode').addEventListener('click', () => setViewMode('simple'));
$('#detailMode').addEventListener('click', () => setViewMode('detail'));
$('#allScope').addEventListener('click', () => setScope(false));
$('#listedScope').addEventListener('click', () => setScope(true));

const dialog = $('#helpDialog');
$('#showHelp').addEventListener('click', () => dialog.showModal());
$('#closeHelp').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});

init();
