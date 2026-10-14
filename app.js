'use strict';

/* ================= 常量 ================= */

const STORAGE_KEY = 'whats-for-dinner:v1';

const CATEGORIES = [
  { key: 'hun',    name: '荤菜', emoji: '🍗' },
  { key: 'su',     name: '素菜', emoji: '🥬' },
  { key: 'tang',   name: '汤',   emoji: '🍲' },
  { key: 'zhushi', name: '主食', emoji: '🍚' },
];
const CAT_MAP = Object.fromEntries(CATEGORIES.map(c => [c.key, c]));

const DEFAULT_COUNTS = { hun: 1, su: 1, tang: 1, zhushi: 0 };
const DEFAULT_NO_REPEAT_DAYS = 7;

const EXAMPLE_DISHES = [
  { name: '红烧肉',     category: 'hun',    note: '肥而不腻，全家都爱' },
  { name: '糖醋排骨',   category: 'hun',    note: '' },
  { name: '可乐鸡翅',   category: 'hun',    note: '做法简单，孩子最爱' },
  { name: '番茄炒蛋',   category: 'hun',    note: '' },
  { name: '清蒸鲈鱼',   category: 'hun',    note: '记得买姜和葱' },
  { name: '青椒肉丝',   category: 'hun',    note: '' },
  { name: '蒜蓉西兰花', category: 'su',     note: '' },
  { name: '麻婆豆腐',   category: 'su',     note: '微辣' },
  { name: '醋溜土豆丝', category: 'su',     note: '切丝泡水更脆' },
  { name: '清炒菠菜',   category: 'su',     note: '' },
  { name: '番茄蛋花汤', category: 'tang',   note: '' },
  { name: '紫菜虾皮汤', category: 'tang',   note: '十分钟搞定' },
  { name: '冬瓜排骨汤', category: 'tang',   note: '' },
  { name: '米饭',       category: 'zhushi', note: '' },
  { name: '手擀面',     category: 'zhushi', note: '' },
];

/* ================= 状态 ================= */

let state = null;
let currentMeal = null;
let pendingImport = null;
let toastTimer = null;

function uid() {
  return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function seedState() {
  return {
    dishes: EXAMPLE_DISHES.map(d => ({
      id: uid(), name: d.name, category: d.category, note: d.note || '', createdAt: Date.now(),
    })),
    history: [],
    settings: { counts: { ...DEFAULT_COUNTS }, noRepeatDays: DEFAULT_NO_REPEAT_DAYS },
  };
}

function normalizeState(s) {
  if (!s || !Array.isArray(s.dishes) || !Array.isArray(s.history)) return null;
  const settings = s.settings || {};
  const days = Number(settings.noRepeatDays);
  return {
    dishes: s.dishes
      .filter(d => d && d.name)
      .map(d => ({
        id: d.id || uid(),
        name: String(d.name).slice(0, 30),
        category: CAT_MAP[d.category] ? d.category : 'hun',
        note: String(d.note || '').slice(0, 50),
        createdAt: d.createdAt || Date.now(),
      })),
    history: s.history
      .filter(h => h && Array.isArray(h.items))
      .map(h => ({ id: h.id || uid(), date: h.date || new Date().toISOString(), items: h.items })),
    settings: {
      counts: { ...DEFAULT_COUNTS, ...(settings.counts || {}) },
      noRepeatDays: Number.isFinite(days) ? Math.min(30, Math.max(0, Math.round(days))) : DEFAULT_NO_REPEAT_DAYS,
    },
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return normalizeState(JSON.parse(raw));
  } catch (e) {
    return null;
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    toast('保存失败：浏览器存储不可用');
  }
}

function initState() {
  state = loadState();
  if (!state) {
    state = seedState();
    saveState();
  }
}

/* ================= 抽菜逻辑 ================= */

function recentEatenIds(days) {
  if (!days || days <= 0) return new Set();
  const cutoff = Date.now() - days * 86400000;
  const ids = new Set();
  for (const h of state.history) {
    const t = new Date(h.date).getTime();
    if (Number.isFinite(t) && t >= cutoff) h.items.forEach(it => ids.add(it.id));
  }
  return ids;
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function toItem(d) {
  return { id: d.id, name: d.name, category: d.category, note: d.note || '' };
}

function pickDishes(catKey, want, eaten) {
  const all = state.dishes.filter(d => d.category === catKey);
  if (all.length === 0) {
    return { picked: [], note: '还没有录过' + CAT_MAP[catKey].name + '，去「我的菜谱」添加几道吧' };
  }
  let pool = all.filter(d => !eaten.has(d.id));
  let note = '';
  if (pool.length < want) {
    if (all.length < want) {
      note = CAT_MAP[catKey].name + '只录了 ' + all.length + ' 道，先抽 ' + all.length + ' 道，有空多录几道';
    } else {
      note = CAT_MAP[catKey].name + '避开最近吃过的之后不够抽，已把最近吃过的放回来';
    }
    pool = all;
  }
  return { picked: shuffle(pool).slice(0, want), note: note };
}

function generateMeal() {
  const counts = state.settings.counts;
  const noRepeatDays = state.settings.noRepeatDays;
  const eaten = recentEatenIds(noRepeatDays);
  const items = [];
  const notes = [];
  for (const cat of CATEGORIES) {
    const want = Math.min(3, Math.max(0, counts[cat.key] | 0));
    if (want <= 0) continue;
    const r = pickDishes(cat.key, want, eaten);
    r.picked.forEach(d => items.push(toItem(d)));
    if (r.note) notes.push(r.note);
  }
  if (items.length === 0 && notes.length === 0) notes.push('搭配数量都是 0，先把上面的数量调起来');
  return { items: items, notes: notes, eatenCount: eaten.size, saved: false };
}

function swapOne(idx) {
  const item = currentMeal && currentMeal.items[idx];
  if (!item) return;
  const eaten = recentEatenIds(state.settings.noRepeatDays);
  const drawn = new Set(currentMeal.items.filter(i => i.category === item.category).map(i => i.id));
  const all = state.dishes.filter(d => d.category === item.category);
  let pool = all.filter(d => !drawn.has(d.id) && !eaten.has(d.id));
  if (pool.length === 0) pool = all.filter(d => !drawn.has(d.id));
  if (pool.length === 0) {
    toast(CAT_MAP[item.category].name + '只录了这一道，换不了啦，先去添加几道吧');
    return;
  }
  currentMeal.items[idx] = toItem(pool[Math.floor(Math.random() * pool.length)]);
  renderResult();
}

function confirmMeal() {
  if (!currentMeal || currentMeal.saved || currentMeal.items.length === 0) return;
  state.history.unshift({
    id: uid(),
    date: new Date().toISOString(),
    items: currentMeal.items.map(i => ({ id: i.id, name: i.name, category: i.category })),
  });
  saveState();
  currentMeal.saved = true;
  renderResult();
  renderHistory();
  toast('已记录，开饭！🍚');
}

/* ================= 工具函数 ================= */

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const pad = n => String(n).padStart(2, '0');
  const wd = '日一二三四五六'[d.getDay()];
  return (d.getMonth() + 1) + '月' + d.getDate() + '日 周' + wd + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

let toastTimer2 = null;
function toast(msg) {
  const t = $('#toast');
  if (!t) return;
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer2);
  toastTimer2 = setTimeout(() => t.classList.remove('show'), 2400);
}

/* ================= 渲染 ================= */

function renderSettings() {
  for (const c of CATEGORIES) {
    const el = $('.stepper[data-cat="' + c.key + '"] .step-num');
    if (el) el.textContent = state.settings.counts[c.key];
  }
  const days = $('#no-repeat-days');
  if (days) days.value = state.settings.noRepeatDays;
}

function renderResult() {
  const box = $('#result');
  if (!box) return;
  if (!currentMeal) { box.classList.add('hidden'); box.innerHTML = ''; return; }

  if (currentMeal.items.length === 0) {
    box.classList.remove('hidden');
    box.innerHTML = '<div class="hint">💡 ' + esc(currentMeal.notes.join('；')) + '</div>';
    return;
  }

  const swapBtn = i => currentMeal.saved ? '' :
    '<button class="btn btn-ghost btn-swap" data-idx="' + i + '">换一个</button>';

  box.classList.remove('hidden');
  box.innerHTML =
    '<div class="dishes">' +
      currentMeal.items.map((it, i) => {
        const c = CAT_MAP[it.category];
        return '<div class="dish-card cat-' + it.category + '" style="animation-delay:' + (i * 90) + 'ms">' +
          '<div class="dish-main">' +
            '<span class="chip chip-' + it.category + '">' + c.emoji + ' ' + c.name + '</span>' +
            '<span class="dish-name">' + esc(it.name) + '</span>' +
            (it.note ? '<span class="dish-note">' + esc(it.note) + '</span>' : '') +
          '</div>' +
          swapBtn(i) +
        '</div>';
      }).join('') +
    '</div>' +
    (currentMeal.eatenCount > 0
      ? '<div class="avoid-line">🚫 已避开最近 ' + state.settings.noRepeatDays + ' 天吃过的 ' + currentMeal.eatenCount + ' 道菜</div>'
      : '') +
    (currentMeal.notes.length
      ? '<div class="hint">💡 ' + esc(currentMeal.notes.join('；')) + '</div>'
      : '') +
    '<div class="result-actions">' +
      (currentMeal.saved
        ? '<span class="saved-flag">✓ 已记入「最近吃了什么」</span>'
        : '<button class="btn" id="btn-redraw">🔄 重新抽</button>' +
          '<button class="btn btn-primary" id="btn-confirm">✓ 就吃这个</button>') +
    '</div>';
}

function renderHistory() {
  const list = $('#history-list');
  const empty = $('#history-empty');
  if (!list || !empty) return;
  if (state.history.length === 0) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.history.map(h =>
    '<li class="history-item">' +
      '<div class="history-info">' +
        '<span class="history-date">' + esc(fmtDate(h.date)) + '</span>' +
        '<span class="history-dishes">' + esc(h.items.map(i => i.name).join('、')) + '</span>' +
      '</div>' +
      '<button class="btn btn-ghost btn-del-hist" data-id="' + h.id + '" title="删除这条记录">✕</button>' +
    '</li>'
  ).join('');
}

function dishRowHtml(d) {
  return '<li class="dish-row" data-id="' + d.id + '">' +
    '<div class="dish-info">' +
      '<span class="dish-name-s">' + esc(d.name) + '</span>' +
      (d.note ? '<span class="dish-note">' + esc(d.note) + '</span>' : '') +
    '</div>' +
    '<div class="dish-ops">' +
      '<button class="btn btn-ghost btn-sm btn-edit" data-id="' + d.id + '">编辑</button>' +
      '<button class="btn btn-ghost btn-sm btn-del" data-id="' + d.id + '">删除</button>' +
    '</div>' +
  '</li>';
}

function renderEditRow(li, d) {
  li.innerHTML =
    '<form class="edit-form" data-id="' + d.id + '">' +
      '<input name="name" value="' + esc(d.name) + '" maxlength="30" required placeholder="菜名">' +
      '<select name="category">' +
        CATEGORIES.map(c => '<option value="' + c.key + '"' + (c.key === d.category ? ' selected' : '') + '>' + c.emoji + ' ' + c.name + '</option>').join('') +
      '</select>' +
      '<input name="note" value="' + esc(d.note || '') + '" maxlength="50" placeholder="备注（可选）">' +
      '<div class="edit-ops">' +
        '<button type="submit" class="btn btn-primary btn-sm">保存</button>' +
        '<button type="button" class="btn btn-ghost btn-sm btn-cancel-edit">取消</button>' +
      '</div>' +
    '</form>';
}

function renderDishList() {
  const countEl = $('#dish-count');
  const box = $('#dish-list');
  if (!countEl || !box) return;
  countEl.textContent = '共 ' + state.dishes.length + ' 道';
  box.innerHTML = CATEGORIES.map(c => {
    const dishes = state.dishes.filter(d => d.category === c.key);
    return '<div class="dish-group">' +
      '<h3 class="group-title">' + c.emoji + ' ' + c.name + ' <span class="muted">' + dishes.length + '</span></h3>' +
      (dishes.length === 0
        ? '<p class="muted empty-tip">还没录过，去上面添加一道吧</p>'
        : '<ul class="dish-rows">' + dishes.map(dishRowHtml).join('') + '</ul>') +
    '</div>';
  }).join('');
}

function renderAll() {
  renderSettings();
  renderResult();
  renderHistory();
  renderDishList();
}

/* ================= 二次点击确认 ================= */

function armButton(btn, confirmText, action) {
  if (btn.dataset.armed === '1') {
    disarmButton(btn);
    action();
    return;
  }
  disarmAllArmed();
  btn.dataset.armed = '1';
  btn.dataset.origText = btn.textContent;
  btn.textContent = confirmText;
  btn.classList.add('armed');
  btn._disarmTimer = setTimeout(() => disarmButton(btn), 2500);
}

function disarmButton(btn) {
  clearTimeout(btn._disarmTimer);
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.textContent = btn.dataset.origText || btn.textContent;
  }
  btn.classList.remove('armed');
}

function disarmAllArmed() {
  $$('.armed').forEach(disarmButton);
}

/* ================= 备份导入导出 ================= */

function exportJSON() {
  return JSON.stringify({
    app: 'whats-for-dinner',
    version: 1,
    exportedAt: new Date().toISOString(),
    dishes: state.dishes,
    history: state.history,
    settings: state.settings,
  }, null, 2);
}

function exportBackup() {
  const blob = new Blob([exportJSON()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  a.href = url;
  a.download = '今天吃什么-备份-' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  toast('备份文件已开始下载 ⬇️');
}

function importJSON(text) {
  const data = JSON.parse(text);
  const normalized = normalizeState({ dishes: data.dishes, history: data.history, settings: data.settings });
  if (!normalized) throw new Error('备份文件格式不对');
  if (normalized.dishes.length === 0) throw new Error('备份里没有菜');
  state = normalized;
  saveState();
  currentMeal = null;
  renderAll();
}

function onImportFileChange(e) {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      const normalized = normalizeState(data);
      if (!normalized) throw new Error('格式不对');
      pendingImport = reader.result;
      $('#import-confirm-text').textContent =
        '将覆盖现有 ' + state.dishes.length + ' 道菜、' + state.history.length + ' 条记录，' +
        '换成备份里的 ' + normalized.dishes.length + ' 道菜、' + normalized.history.length + ' 条记录。';
      $('#import-confirm').classList.remove('hidden');
    } catch (err) {
      toast('这个文件读不了：' + (err && err.message ? err.message : '格式不对'));
    }
  };
  reader.readAsText(file);
}

function hideImportConfirm() {
  pendingImport = null;
  $('#import-confirm').classList.add('hidden');
}

/* ================= 事件绑定 ================= */

function bindEvents() {
  $('#btn-generate').addEventListener('click', () => {
    currentMeal = generateMeal();
    renderResult();
  });

  $('#result').addEventListener('click', e => {
    const swap = e.target.closest('.btn-swap');
    if (swap) { swapOne(+swap.dataset.idx); return; }
    if (e.target.closest('#btn-redraw')) { currentMeal = generateMeal(); renderResult(); return; }
    if (e.target.closest('#btn-confirm')) { confirmMeal(); return; }
  });

  $('#steppers').addEventListener('click', e => {
    const btn = e.target.closest('.step-btn');
    if (!btn) return;
    const stepper = btn.closest('.stepper');
    const cat = stepper.dataset.cat;
    const cur = state.settings.counts[cat];
    const next = Math.min(3, Math.max(0, cur + (+btn.dataset.dir)));
    if (next === cur) return;
    state.settings.counts[cat] = next;
    saveState();
    renderSettings();
  });

  $('#no-repeat-days').addEventListener('change', e => {
    const v = Math.min(30, Math.max(0, parseInt(e.target.value, 10) || 0));
    e.target.value = v;
    state.settings.noRepeatDays = v;
    saveState();
  });

  $('#history-list').addEventListener('click', e => {
    const btn = e.target.closest('.btn-del-hist');
    if (!btn) return;
    state.history = state.history.filter(h => h.id !== btn.dataset.id);
    saveState();
    renderHistory();
    toast('已删除这条记录');
  });

  // 添加菜
  const form = $('#dish-form');
  const addBtn = $('#btn-add');
  let dupArmed = false;
  form.addEventListener('input', () => {
    if (dupArmed) {
      dupArmed = false;
      addBtn.textContent = '＋ 添加';
      addBtn.classList.remove('armed');
    }
  });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const name = form.querySelector('[name="name"]').value.trim();
    if (!name) return;
    const dup = state.dishes.some(d => d.name === name);
    if (dup && !dupArmed) {
      dupArmed = true;
      addBtn.textContent = '已有同名菜，再点一次确认';
      addBtn.classList.add('armed');
      return;
    }
    dupArmed = false;
    addBtn.textContent = '＋ 添加';
    addBtn.classList.remove('armed');
    state.dishes.push({
      id: uid(),
      name: name.slice(0, 30),
      category: form.querySelector('[name="category"]').value,
      note: form.querySelector('[name="note"]').value.trim().slice(0, 50),
      createdAt: Date.now(),
    });
    saveState();
    renderDishList();
    form.querySelector('[name="name"]').value = '';
    form.querySelector('[name="note"]').value = '';
    toast('已添加「' + name + '」');
  });

  // 编辑 / 删除
  const dishList = $('#dish-list');
  dishList.addEventListener('click', e => {
    const editBtn = e.target.closest('.btn-edit');
    if (editBtn) {
      const li = editBtn.closest('.dish-row');
      const d = state.dishes.find(x => x.id === li.dataset.id);
      if (d) renderEditRow(li, d);
      return;
    }
    const delBtn = e.target.closest('.btn-del');
    if (delBtn) {
      armButton(delBtn, '再点一次删除', () => {
        state.dishes = state.dishes.filter(x => x.id !== delBtn.dataset.id);
        saveState();
        renderDishList();
        toast('已删除');
      });
      return;
    }
    if (e.target.closest('.btn-cancel-edit')) { renderDishList(); return; }
  });
  dishList.addEventListener('submit', e => {
    const formEl = e.target.closest('.edit-form');
    if (!formEl) return;
    e.preventDefault();
    const d = state.dishes.find(x => x.id === formEl.dataset.id);
    if (!d) { renderDishList(); return; }
    const name = formEl.querySelector('[name="name"]').value.trim();
    if (!name) { formEl.querySelector('[name="name"]').focus(); return; }
    d.name = name.slice(0, 30);
    d.category = formEl.querySelector('[name="category"]').value;
    d.note = formEl.querySelector('[name="note"]').value.trim().slice(0, 50);
    saveState();
    renderDishList();
    toast('已保存');
  });

  // 备份
  $('#btn-export').addEventListener('click', exportBackup);
  $('#import-file').addEventListener('change', onImportFileChange);
  $('#btn-import-yes').addEventListener('click', () => {
    if (!pendingImport) return;
    try {
      importJSON(pendingImport);
      toast('导入成功 ✓');
    } catch (err) {
      toast('导入失败：' + (err && err.message ? err.message : '文件格式不对'));
    }
    hideImportConfirm();
  });
  $('#btn-import-no').addEventListener('click', hideImportConfirm);

  $('#btn-reset').addEventListener('click', () => {
    armButton($('#btn-reset'), '再点一次确认恢复', () => {
      state.dishes = EXAMPLE_DISHES.map(d => ({
        id: uid(), name: d.name, category: d.category, note: d.note || '', createdAt: Date.now(),
      }));
      saveState();
      currentMeal = null;
      renderAll();
      toast('已恢复示例菜谱（历史记录保留）');
    });
  });
}

/* ================= 启动 ================= */

function init() {
  initState();
  bindEvents();
  renderAll();
}

init();

/* 调试 / 进阶接口（控制台可用） */
window.app = {
  exportJSON: exportJSON,
  importJSON: importJSON,
  get state() { return state; },
};
