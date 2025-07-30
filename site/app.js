async function load() {
  const res = await fetch('./data/articles.json', { cache: 'no-store' });
  const data = await res.json();
  const items = data.items || [];

  const sourceSel = document.getElementById('source');
  const qInput = document.getElementById('q');
  const list = document.getElementById('list');
  const count = document.getElementById('count');

  // Populate source filter
  const sources = Array.from(new Set(items.map(i => i.source))).sort();
  sourceSel.innerHTML = ['<option value="">Todas las fuentes</option>']
    .concat(sources.map(s => `<option value="${s}">${s}</option>`)).join('');

  function render() {
    const q = (qInput.value || '').toLowerCase();
    const s = sourceSel.value;
    const filtered = items.filter(it => {
      const okS = !s || it.source === s;
      const hay = `${it.title} ${it.teaser}`.toLowerCase();
      const okQ = !q || hay.includes(q);
      return okS && okQ;
    });
    count.textContent = `${filtered.length} artículos`;
    list.innerHTML = filtered.map(it => `
      <article class="card">
        <div class="meta">
          <span class="source">${it.source}</span>
          <time>${it.date ? new Date(it.date).toLocaleDateString('es-AR') : ''}</time>
        </div>
        <a href="${it.url}" target="_blank" rel="noopener">
          <h3>${it.title}</h3>
        </a>
        ${it.teaser ? `<p class="teaser">${it.teaser}</p>` : ''}
      </article>
    `).join('');
  }

  qInput.addEventListener('input', render);
  sourceSel.addEventListener('change', render);
  document.getElementById('clear').addEventListener('click', () => {
    qInput.value = ''; sourceSel.value = ''; render();
  });

  render();
}
load();
