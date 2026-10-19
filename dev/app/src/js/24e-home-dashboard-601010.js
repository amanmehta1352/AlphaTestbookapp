/* Live Home layout adapter: preserve all current renderers, data and actions. */
const renderHomePageBefore601010 = renderHomePage;
renderHomePage = function(v) {
  renderHomePageBefore601010(v);
  const root = v.querySelector('.sj-dash.ao-home');
  if (!root || root.dataset.layout601010 === 'true') return;

  const main = document.createElement('div');
  main.className = 'ao-home-main';
  main.setAttribute('aria-label', tx('Main study dashboard', 'मुख्य अध्ययन डैशबोर्ड'));

  const side = document.createElement('aside');
  side.className = 'ao-home-side';
  side.setAttribute('aria-label', tx("Today's study focus", 'आज की पढ़ाई का फोकस'));

  root.classList.add('ao-home-601010');
  root.dataset.layout601010 = 'true';
  // Put the focus column first in DOM reading order; CSS places it on the right on desktop.
  root.insertBefore(side, root.firstChild);
  root.insertBefore(main, side.nextSibling);

  const move = (selector, target) => {
    const element = Array.from(root.children).find(child => child.matches(selector));
    if (element) target.appendChild(element);
  };

  // Keep Continue → daily goal → preparation shortcuts in DOM reading order.
  move('.ao-next', side);
  move('.ao-today', side);
  move('.gx-hero', main);
  move('.gx-quick', main);
  move('.gx-search', main);
  move('.ao-followups', side);

  const details = Array.from(root.children).find(child => child.matches('.ao-details'));
  if (details) details.setAttribute('aria-label', tx('Progress and study tools', 'प्रगति और अध्ययन टूल'));
};
