const status = document.querySelector('#score-status');
const plot = document.querySelector('#score-plot');
const details = document.querySelector('#score-details');
const svg = plot.querySelector('svg');
const views = document.querySelector('#score-views');
const scoreIntro = document.querySelector('#score-intro');
const scoreCaption = document.querySelector('#score-caption');
const scoreAnnotation = document.querySelector('#score-annotation');
const scorePairedNote = document.querySelector('#score-paired-note');
const scoreBaseline = document.querySelector('#score-baseline');
const scoreBaselineLabel = document.querySelector('#score-baseline-label');
const reasoningNote = document.querySelector('#reasoning-note');
const scoreRows = document.querySelector('#score-table tbody');
const originalCopy = {
  intro: scoreIntro.textContent,
  caption: scoreCaption.textContent,
  annotation: scoreAnnotation.textContent,
};
const originalBaseline = { forecastsCorrect: 5, pairedCorrect: 0, label: 'Always guessing “both finished”' };
const bounds = { left: 82, right: 946, top: 38, bottom: 302 };
const tones = ['lime', 'cyan', 'violet', 'amber', 'rose', 'blue', 'mint'];
const brandMarks = new Map([
  ['google', 'google'], ['deepseek', 'deepseek'], ['anthropic', 'anthropic'],
  ['mistralai', 'mistral'], ['qwen', 'qwen'], ['openai', 'openai'],
  ['meta-llama', 'meta'], ['nvidia', 'nvidia'],
]);

function svgElement(name, attributes = {}, content = '') {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value);
  if (content) element.textContent = content;
  return element;
}

function overlaps(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

function modelName(model) {
  return model.reasoningEffort ? `${model.label} · reasoning: ${model.reasoningEffort}` : model.label;
}

function plotScores({ models, forecastsTotal: forecastTotal, pairedTotal, baseline }) {
  svg.replaceChildren();
  const maxX = Math.min(forecastTotal, Math.max(10, baseline?.forecastsCorrect ?? 0, Math.ceil((models[0].forecastsCorrect + 1) / 2) * 2));
  const maxY = Math.min(pairedTotal, Math.max(3, baseline?.pairedCorrect ?? 0, ...models.map(model => model.pairedCorrect + 1)));
  const xStep = maxX > 14 ? 4 : 2;
  const yStep = maxY > 6 ? 2 : 1;
  const { left, right, top, bottom } = bounds;
  const x = score => left + score / maxX * (right - left);
  const y = score => bottom - score / maxY * (bottom - top);

  svg.append(
    svgElement('title', { id: 'plot-title' }, 'Forecast accuracy and paired checks by model'),
    svgElement('desc', { id: 'plot-desc' }, `The horizontal axis shows 0 to ${maxX} correct forecasts out of ${forecastTotal} possible. The vertical axis shows 0 to ${maxY} paired checks out of ${pairedTotal} possible. Models with identical scores share a marker. When badges are moved to make room, a dot marks their exact scores.`),
    svgElement('text', { class: 'plot-axis-title', x: left, y: 20 }, `Paired checks passed (out of ${pairedTotal})`),
    svgElement('text', { class: 'plot-axis-title', x: (left + right) / 2, y: 367, 'text-anchor': 'middle' }, `Correct forecasts (out of ${forecastTotal})`),
  );

  const xTicks = Array.from({ length: Math.floor(maxX / xStep) + 1 }, (_, i) => i * xStep);
  if (xTicks.at(-1) !== maxX) xTicks.push(maxX);
  for (const tick of xTicks) {
    svg.append(
      svgElement('line', { class: tick === 0 ? 'plot-axis-line' : 'plot-grid', x1: x(tick), x2: x(tick), y1: top, y2: bottom }),
      svgElement('text', { class: 'plot-tick', x: x(tick), y: bottom + 31, 'text-anchor': 'middle' }, String(tick)),
    );
  }
  const yTicks = Array.from({ length: Math.floor(maxY / yStep) + 1 }, (_, i) => i * yStep);
  if (yTicks.at(-1) !== maxY) yTicks.push(maxY);
  for (const tick of yTicks) {
    svg.append(
      svgElement('line', { class: tick === 0 ? 'plot-axis-line' : 'plot-grid', x1: left, x2: right, y1: y(tick), y2: y(tick) }),
      svgElement('text', { class: 'plot-tick', x: left - 26, y: y(tick) + 5, 'text-anchor': 'middle' }, String(tick)),
    );
  }
  if (baseline) {
    const baselineX = x(baseline.forecastsCorrect);
    svg.append(svgElement('line', { class: 'plot-baseline', x1: baselineX, x2: baselineX, y1: top, y2: bottom }));
  }

  const groups = new Map();
  for (const model of models) {
    const key = `${model.forecastsCorrect}/${model.pairedCorrect}`;
    const group = groups.get(key) ?? [];
    group.push(model);
    groups.set(key, group);
  }

  const namesReadout = plot.querySelector('.plot-readout-models');
  const scoreReadout = plot.querySelector('.plot-readout-score');
  const points = [...groups.values()].map(group => {
    const providers = [...new Set(group.map(model => model.modelId?.split('/')[0]))];
    const brands = providers.map(provider => brandMarks.get(provider));
    const anchorX = x(group[0].forecastsCorrect);
    const anchorY = y(group[0].pairedCorrect);
    const badgeWidth = 36 + (brands.length - 1) * 26;
    return { group, brands, anchorX, anchorY, badgeWidth };
  });
  const occupied = [];
  const anchors = points.map(({ anchorX, anchorY }) => ({
    left: anchorX - 4, right: anchorX + 4, top: anchorY - 4, bottom: anchorY + 4,
  }));
  const badges = points.map((point, index) => {
    const { anchorX, anchorY, badgeWidth } = point;
    const candidates = [0, -44, 44, -88, 88, -132, 132].map(offset => {
      const centerY = anchorY + offset;
      return { centerY, box: {
        left: anchorX - badgeWidth / 2 - 4, right: anchorX + badgeWidth / 2 + 4,
        top: centerY - 22, bottom: centerY + 22,
      } };
    });
    const placement = candidates.find(({ centerY, box }) => centerY >= top && centerY <= bottom
      && !occupied.some(other => overlaps(box, other))
      && !anchors.some((other, i) => i !== index && overlaps(box, other))) ?? candidates[0];
    occupied.push(placement.box);
    return { ...point, centerY: placement.centerY };
  });
  let selected;
  for (const [index, { group, brands, anchorX: centerX, anchorY, centerY, badgeWidth }] of badges.entries()) {
    const { forecastsCorrect, pairedCorrect, label } = group[0];
    const nameList = group.map(modelName).join(' · ');
    const scoreText = `${forecastsCorrect}/${forecastTotal} forecasts · ${pairedCorrect}/${pairedTotal} paired checks`;
    const marker = svgElement('g', {
      class: 'plot-marker', role: 'button', tabindex: '0', 'aria-pressed': 'false',
      'aria-label': `${nameList}, ${scoreText}`, 'data-tone': tones[index % tones.length],
    });
    const hasReasoning = group.some(model => model.reasoningEffort);
    const labelText = `${group.length > 1 ? `${group.length} models tied` : label}${hasReasoning ? ' *' : ''}`;
    const labelWidth = labelText.length * 11 + 10;
    const labelDirections = centerX < (left + right) / 2 ? [1, -1] : [-1, 1];
    const callout = svgElement('g', { class: 'plot-callout', 'aria-hidden': 'true' });
    const offsets = [-29, 36, -52, 59, -75, 82, -98, 105, -121, 128, -144, 151, -167, 174];
    const labelPlacement = offsets.flatMap(offset => labelDirections.map(direction => {
      const labelX = centerX + 22 * direction;
      const labelY = centerY + offset;
      const box = {
        left: labelX - (direction === -1 ? labelWidth : 0),
        right: labelX + (direction === 1 ? labelWidth : 0),
        top: labelY - 21, bottom: labelY + 6,
      };
      return { direction, labelX, labelY, box };
    })).find(({ box }) => box.left >= left - 10 && box.right <= 988 && box.top >= top - 5
      && box.bottom <= bottom + 4 && !occupied.some(other => overlaps(box, other)));
    if (labelPlacement) {
      const { direction, labelX, labelY, box } = labelPlacement;
      const elbowY = labelY + (labelY < centerY ? 6 : -8);
      occupied.push(box);
      callout.append(
        svgElement('path', { class: 'plot-callout-line', d: `M ${centerX} ${centerY} V ${elbowY} H ${labelX - 5 * direction}` }),
        svgElement('text', { class: 'plot-callout-text', x: labelX, y: labelY, 'text-anchor': direction === 1 ? 'start' : 'end' }, labelText),
      );
    }
    const badgeX = centerX - badgeWidth / 2;
    if (centerY !== anchorY) {
      marker.append(
        svgElement('line', { class: 'plot-callout-line', x1: centerX, x2: centerX, y1: anchorY, y2: centerY, 'aria-hidden': 'true' }),
        svgElement('circle', { class: 'plot-axis-title', cx: centerX, cy: anchorY, r: 3, 'aria-hidden': 'true' }),
      );
    }
    marker.append(
      svgElement('title', {}, `${nameList} · ${scoreText}`),
      callout,
      svgElement('rect', { class: 'plot-hit', x: badgeX - 5, y: centerY - 22, width: badgeWidth + 10, height: 44, rx: 13 }),
      svgElement('rect', { class: 'plot-badge', x: badgeX, y: centerY - 17, width: badgeWidth, height: 34, rx: 10 }),
    );
    brands.forEach((brand, logoIndex) => {
      const iconX = badgeX + 7 + logoIndex * 26;
      marker.append(brand ? svgElement('image', {
        href: `/brand/${brand}.svg`, x: iconX, y: centerY - 11,
        width: 22, height: 22, 'aria-hidden': 'true',
      }) : svgElement('circle', { class: 'plot-badge-dot', cx: iconX + 11, cy: centerY, r: 4 }));
    });
    if (hasReasoning && !labelPlacement) {
      marker.append(svgElement('text', { class: 'plot-callout-text', x: badgeX + badgeWidth - 2, y: centerY - 13, 'aria-hidden': 'true' }, '*'));
    }
    const select = () => {
      if (selected === marker) return;
      selected?.setAttribute('aria-pressed', 'false');
      selected = marker;
      marker.setAttribute('aria-pressed', 'true');
      namesReadout.textContent = nameList;
      scoreReadout.textContent = scoreText;
    };
    marker.addEventListener('click', select);
    marker.addEventListener('pointerenter', select);
    marker.addEventListener('focus', select);
    marker.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        select();
      }
    });
    svg.append(marker);
    if (index === 0) select();
  }
}

function scoreCell(correct, total) {
  const cell = document.createElement('td');
  cell.textContent = `${correct}/${total}`;
  return cell;
}

function validScore(score, total) {
  return Number.isInteger(score) && score >= 0 && score <= total;
}

async function loadScores(path, isHard) {
  const response = await fetch(path);
  if (!response.ok) throw new Error('Score data unavailable.');
  const data = await response.json();
  const { models } = data;
  if (!Array.isArray(models) || !models.length) throw new Error('No comparable scores available.');
  const { forecastsTotal, pairedTotal } = models[0];
  if (!Number.isInteger(forecastsTotal) || forecastsTotal <= 0 || !Number.isInteger(pairedTotal) || pairedTotal <= 0
    || models.some(model => typeof model.label !== 'string' || model.forecastsTotal !== forecastsTotal
      || !validScore(model.forecastsCorrect, forecastsTotal)
      || model.pairedTotal !== pairedTotal || !validScore(model.pairedCorrect, pairedTotal))) {
    throw new Error('No comparable scores available.');
  }
  models.sort((a, b) => b.forecastsCorrect - a.forecastsCorrect || a.label.localeCompare(b.label));
  const baseline = isHard ? data.baseline : originalBaseline;
  const hasBaseline = validScore(baseline?.forecastsCorrect, forecastsTotal)
    && validScore(baseline?.pairedCorrect, pairedTotal);
  const reference = data.reference;
  const hasReference = validScore(reference?.forecastsCorrect, forecastsTotal)
    && validScore(reference?.pairedCorrect, pairedTotal);
  const copy = isHard ? {
    intro: `We reran only the ${models.length} models that scored perfectly in the original pilot. ${data.description || 'They forecast a more demanding series of events after seeing practice runs.'}`,
    caption: 'Harder follow-up · rules inferred from examples',
    annotation: hasReference
      ? `The reference solver scored ${reference.forecastsCorrect}/${forecastsTotal} forecasts and ${reference.pairedCorrect}/${pairedTotal} paired checks.`
      : 'The follow-up uses its own cases and scoring totals.',
  } : originalCopy;
  return { models, forecastsTotal, pairedTotal, baseline: hasBaseline ? baseline : null, copy };
}

function renderScores(data) {
  const { models, forecastsTotal, pairedTotal, baseline, copy } = data;
  plotScores(data);
  reasoningNote.hidden = !models.some(model => model.reasoningEffort);
  scoreIntro.textContent = copy.intro;
  scoreCaption.textContent = copy.caption;
  scoreAnnotation.textContent = copy.annotation;
  scorePairedNote.textContent = `There were ${pairedTotal} such checks.`;
  scoreBaseline.hidden = !baseline;
  if (baseline) {
    scoreBaselineLabel.textContent = `${baseline.label || 'Guessing baseline'} (${baseline.forecastsCorrect}/${forecastsTotal} forecasts)`;
  }

  const rows = models.map(model => {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = modelName(model);
    row.append(name, scoreCell(model.forecastsCorrect, model.forecastsTotal), scoreCell(model.pairedCorrect, model.pairedTotal));
    return row;
  });

  scoreRows.replaceChildren(...rows);
  plot.hidden = false;
  details.hidden = false;
  status.hidden = true;
}

const [original, hard] = await Promise.allSettled([
  loadScores('/pilot-scores.json', false),
  loadScores('/pilot-hard-scores.json', true),
]);
const scoreData = {
  original: original.status === 'fulfilled' ? original.value : null,
  hard: hard.status === 'fulfilled' ? hard.value : null,
};
const available = scoreData.original || scoreData.hard;
if (available) {
  const requested = new URLSearchParams(location.search).get('pilot');
  renderScores(requested === 'hard' && scoreData.hard ? scoreData.hard : available);
  if (scoreData.original && scoreData.hard) {
    views.hidden = false;
    const buttons = Array.from(views.querySelectorAll('button'));
    for (const button of buttons) {
      button.textContent += ` (${scoreData[button.dataset.scoreView].models.length})`;
    }
    const select = key => {
      for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.scoreView === key));
    };
    select(requested === 'hard' ? 'hard' : 'original');
    for (const button of buttons) {
      button.addEventListener('click', () => {
        const key = button.dataset.scoreView;
        select(key);
        renderScores(scoreData[key]);
        const url = new URL(location.href);
        if (key === 'hard') url.searchParams.set('pilot', 'hard');
        else url.searchParams.delete('pilot');
        history.replaceState(null, '', url);
      });
    }
  }
} else {
  status.textContent = 'Pilot scores are unavailable.';
}
