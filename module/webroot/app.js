/* ViPER FX — KernelSU WebUI
 *
 * Talks to the DSP through bin/viperctl.sh. Writes are queued and sent one at
 * a time so dragging a slider does not start a root shell for every pixel.
 * There is no background polling: the page only runs commands when you act.
 */
(() => {
  'use strict';

  const MODDIR = '/data/adb/modules/Viper4-XF';
  const CTL = `${MODDIR}/bin/viperctl.sh`;
  const WRITE_DEBOUNCE_MS = 120;

  // Parameters the module exposes. Ranges and defaults mirror the DSP
  // defaults used by ViPER4Android. Values are sent to the DSP as-is.
  //   kind: 'bool' | 'range' | 'select'
  const GROUPS = [
    {
      id: 'limiter',
      title: 'Output',
      desc: 'Master limiter, volume and balance.',
      params: [
        { id: '0x10110', type: 'f', kind: 'range', label: 'Limiter threshold', min: 0.3, max: 1.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x10111', type: 'f', kind: 'range', label: 'Output volume', min: 0.01, max: 2.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x10112', type: 'f', kind: 'range', label: 'Channel pan', min: -1.0, max: 1.0, step: 0.01, def: 0.0, digits: 2, hint: 'Negative favors left, positive favors right.' },
      ],
    },
    {
      id: 'gain',
      title: 'Playback gain',
      desc: 'Automatic gain control that evens out loudness.',
      params: [
        { id: '0x10120', type: 'b', kind: 'bool', label: 'Enable playback gain', def: false },
        { id: '0x10121', type: 'f', kind: 'range', label: 'Strength', min: 0.5, max: 3.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x10122', type: 'f', kind: 'range', label: 'Max gain', min: 1.0, max: 10.0, step: 0.05, def: 1.0, digits: 2 },
        { id: '0x10123', type: 'f', kind: 'range', label: 'Output threshold', min: 0.3, max: 1.0, step: 0.01, def: 1.0, digits: 2 },
      ],
    },
    {
      id: 'bass',
      title: 'Bass',
      desc: 'ViPER bass enhancement.',
      params: [
        { id: '0x10160', type: 'b', kind: 'bool', label: 'Enable bass', def: false },
        {
          id: '0x10161', type: 'i', kind: 'select', label: 'Mode', def: 0,
          options: [[0, 'Natural'], [1, 'Pure Bass+'], [2, 'Subwoofer']],
        },
        { id: '0x10162', type: 'i', kind: 'range', label: 'Frequency', min: 15, max: 150, step: 1, def: 60, digits: 0, unit: 'Hz' },
        { id: '0x10163', type: 'f', kind: 'range', label: 'Gain', min: 0.5, max: 10.0, step: 0.05, def: 0.5, digits: 2 },
        { id: '0x10164', type: 'b', kind: 'bool', label: 'Anti-pop', def: false, hint: 'Reduces the click when bass switches on or off.' },
      ],
    },
    {
      id: 'clarity',
      title: 'Clarity',
      desc: 'High-frequency detail and presence.',
      params: [
        { id: '0x10230', type: 'b', kind: 'bool', label: 'Enable clarity', def: false },
        {
          id: '0x10231', type: 'i', kind: 'select', label: 'Mode', def: 0,
          options: [[0, 'Natural'], [1, 'OZone+'], [2, 'XHiFi']],
        },
        { id: '0x10232', type: 'f', kind: 'range', label: 'Gain', min: 0.0, max: 4.5, step: 0.05, def: 0.5, digits: 2 },
      ],
    },
    {
      id: 'tube',
      title: 'Tube',
      desc: 'Warm analog saturation.',
      params: [
        { id: '0x10250', type: 'b', kind: 'bool', label: 'Enable tube', def: false },
        {
          id: '0x10251', type: 'i', kind: 'select', label: 'Model', def: 0,
          options: [[0, 'Model 1'], [1, 'Model 2'], [2, 'Model 3']],
        },
        { id: '0x10252', type: 'f', kind: 'range', label: 'Drive', min: 0.0, max: 1.0, step: 0.01, def: 0.5, digits: 2 },
        { id: '0x10253', type: 'f', kind: 'range', label: 'Mix', min: 0.0, max: 1.0, step: 0.01, def: 0.3, digits: 2 },
      ],
    },
    {
      id: 'lufs',
      title: 'LUFS targeting',
      desc: 'Keeps loudness near a target level.',
      params: [
        { id: '0x10130', type: 'b', kind: 'bool', label: 'Enable LUFS targeting', def: false },
        { id: '0x10131', type: 'f', kind: 'range', label: 'Target', min: -24.0, max: -8.0, step: 0.5, def: -14.0, digits: 1, unit: 'LUFS' },
        { id: '0x10132', type: 'f', kind: 'range', label: 'Max gain', min: 0.0, max: 12.0, step: 0.1, def: 6.0, digits: 1, unit: 'dB' },
        { id: '0x10133', type: 'i', kind: 'select', label: 'Speed', def: 1, options: [[0, 'Slow'], [1, 'Medium'], [2, 'Fast']] },
      ],
    },
    {
      id: 'spectrum',
      title: 'Spectrum extension',
      desc: 'Rebuilds high frequencies lost in compression.',
      params: [
        { id: '0x10190', type: 'b', kind: 'bool', label: 'Enable spectrum extension', def: false },
        { id: '0x10191', type: 'i', kind: 'range', label: 'Strength', min: 2200, max: 8200, step: 100, def: 7600, digits: 0 },
        { id: '0x10192', type: 'f', kind: 'range', label: 'Exciter', min: 0.0, max: 6.0, step: 0.05, def: 0.0, digits: 2 },
      ],
    },
    {
      id: 'field',
      title: 'Field surround',
      desc: 'Widens the stereo field for a speaker-like image.',
      params: [
        { id: '0x101D0', type: 'b', kind: 'bool', label: 'Enable field surround', def: false },
        { id: '0x101D1', type: 'f', kind: 'range', label: 'Widening', min: 0.0, max: 8.0, step: 0.05, def: 0.0, digits: 2 },
        { id: '0x101D2', type: 'f', kind: 'range', label: 'Mid image', min: 1.0, max: 2.0, step: 0.01, def: 1.5, digits: 2 },
        { id: '0x101D3', type: 'i', kind: 'range', label: 'Depth', min: 200, max: 950, step: 5, def: 200, digits: 0 },
      ],
    },
    {
      id: 'diff',
      title: 'Differential surround',
      desc: 'Adds a delayed, phase-shifted signal for depth.',
      params: [
        { id: '0x101E0', type: 'b', kind: 'bool', label: 'Enable differential surround', def: false },
        { id: '0x101E1', type: 'f', kind: 'range', label: 'Delay', min: 1.0, max: 20.0, step: 0.1, def: 5.0, digits: 1, unit: 'ms' },
        { id: '0x101E2', type: 'b', kind: 'bool', label: 'Reverse channels', def: false },
        { id: '0x101E3', type: 'f', kind: 'range', label: 'Wet/dry mix', min: 0.0, max: 1.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x101E4', type: 'i', kind: 'range', label: 'Low-pass cutoff', min: 0, max: 20000, step: 100, def: 0, digits: 0, unit: 'Hz' },
      ],
    },
    {
      id: 'stereo',
      title: 'Stereo imager',
      desc: 'Sets stereo width separately for low, mid and high bands.',
      params: [
        { id: '0x101F0', type: 'b', kind: 'bool', label: 'Enable stereo imager', def: false },
        { id: '0x101F1', type: 'f', kind: 'range', label: 'Low width', min: 0.0, max: 2.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x101F2', type: 'f', kind: 'range', label: 'Mid width', min: 0.0, max: 2.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x101F3', type: 'f', kind: 'range', label: 'High width', min: 0.0, max: 2.0, step: 0.01, def: 1.0, digits: 2 },
        { id: '0x101F4', type: 'i', kind: 'range', label: 'Low crossover', min: 80, max: 400, step: 10, def: 200, digits: 0, unit: 'Hz' },
        { id: '0x101F5', type: 'i', kind: 'range', label: 'High crossover', min: 2000, max: 8000, step: 100, def: 4000, digits: 0, unit: 'Hz' },
      ],
    },
    {
      id: 'headphone',
      title: 'Headphone surround+',
      desc: 'Virtual surround for headphones.',
      params: [
        { id: '0x10200', type: 'b', kind: 'bool', label: 'Enable headphone surround+', def: false },
        { id: '0x10201', type: 'i', kind: 'range', label: 'Quality', min: 0, max: 4, step: 1, def: 0, digits: 0, hint: 'Higher values use more processing.' },
      ],
    },
    {
      id: 'reverb',
      title: 'Reverberation',
      desc: 'Room reverb for added space.',
      params: [
        { id: '0x10210', type: 'b', kind: 'bool', label: 'Enable reverberation', def: false },
        { id: '0x10211', type: 'f', kind: 'range', label: 'Room size', min: 0.0, max: 1.0, step: 0.01, def: 0.0, digits: 2 },
        { id: '0x10212', type: 'f', kind: 'range', label: 'Width', min: 0.0, max: 1.0, step: 0.01, def: 0.0, digits: 2 },
        { id: '0x10213', type: 'f', kind: 'range', label: 'Damp', min: 0.0, max: 1.0, step: 0.01, def: 0.5, digits: 2 },
        { id: '0x10214', type: 'f', kind: 'range', label: 'Wet', min: 0.0, max: 1.0, step: 0.01, def: 0.0, digits: 2 },
        { id: '0x10215', type: 'f', kind: 'range', label: 'Dry', min: 0.0, max: 1.0, step: 0.01, def: 1.0, digits: 2 },
      ],
    },
    {
      id: 'dynsys',
      title: 'Dynamic system',
      desc: 'Adjusts bass and treble response to playback level.',
      params: [
        { id: '0x10220', type: 'b', kind: 'bool', label: 'Enable dynamic system', def: false },
        { id: '0x10227', type: 'f', kind: 'range', label: 'Strength', min: 0.0, max: 1.0, step: 0.01, def: 0.5, digits: 2 },
        { id: '0x10221', type: 'i', kind: 'range', label: 'Bass X low', min: 0, max: 2400, step: 10, def: 100, digits: 0, unit: 'Hz' },
        { id: '0x10222', type: 'i', kind: 'range', label: 'Bass X high', min: 0, max: 12000, step: 50, def: 5600, digits: 0, unit: 'Hz' },
        { id: '0x10223', type: 'i', kind: 'range', label: 'Bass Y low', min: 0, max: 200, step: 1, def: 40, digits: 0 },
        { id: '0x10224', type: 'i', kind: 'range', label: 'Bass Y high', min: 0, max: 300, step: 1, def: 80, digits: 0 },
        { id: '0x10225', type: 'f', kind: 'range', label: 'Side gain low', min: 0.0, max: 1.0, step: 0.01, def: 0.5, digits: 2 },
        { id: '0x10226', type: 'f', kind: 'range', label: 'Side gain high', min: 0.0, max: 1.0, step: 0.01, def: 0.5, digits: 2 },
      ],
      devicePresets: [
        { name: 'Extreme Headphone (v2)', values: { '0x10221': 140, '0x10222': 6200, '0x10223': 40, '0x10224': 60, '0x10225': 0.1, '0x10226': 0.8 } },
        { name: 'High-End Headphone (v2)', values: { '0x10221': 180, '0x10222': 5800, '0x10223': 55, '0x10224': 80, '0x10225': 0.1, '0x10226': 0.7 } },
        { name: 'Common Headphone (v2)', values: { '0x10221': 300, '0x10222': 5600, '0x10223': 60, '0x10224': 105, '0x10225': 0.1, '0x10226': 0.5 } },
        { name: 'Low-End Headphone (v2)', values: { '0x10221': 600, '0x10222': 5400, '0x10223': 60, '0x10224': 105, '0x10225': 0.1, '0x10226': 0.2 } },
        { name: 'Common Earphone (v2)', values: { '0x10221': 100, '0x10222': 5600, '0x10223': 40, '0x10224': 80, '0x10225': 0.5, '0x10226': 0.5 } },
        { name: 'Extreme Headphone (v1)', values: { '0x10221': 1200, '0x10222': 6200, '0x10223': 40, '0x10224': 80, '0x10225': 0.0, '0x10226': 0.2 } },
        { name: 'High-End Headphone (v1)', values: { '0x10221': 1000, '0x10222': 6200, '0x10223': 40, '0x10224': 80, '0x10225': 0.0, '0x10226': 0.1 } },
        { name: 'Common Headphone (v1)', values: { '0x10221': 800, '0x10222': 6200, '0x10223': 40, '0x10224': 80, '0x10225': 0.1, '0x10226': 0.0 } },
        { name: 'Common Earphone (v1)', values: { '0x10221': 400, '0x10222': 6200, '0x10223': 40, '0x10224': 80, '0x10225': 0.1, '0x10226': 0.0 } },
      ],
    },
    {
      id: 'psycho',
      title: 'Psychoacoustic bass',
      desc: 'Adds harmonics so bass is heard on small speakers and earbuds.',
      params: [
        { id: '0x10180', type: 'b', kind: 'bool', label: 'Enable psychoacoustic bass', def: false },
        { id: '0x10181', type: 'i', kind: 'range', label: 'Cutoff', min: 60, max: 150, step: 1, def: 80, digits: 0, unit: 'Hz' },
        { id: '0x10182', type: 'f', kind: 'range', label: 'Intensity', min: 0.0, max: 1.0, step: 0.01, def: 0.5, digits: 2 },
        { id: '0x10183', type: 'i', kind: 'range', label: 'Harmonic order', min: 2, max: 5, step: 1, def: 3, digits: 0 },
        { id: '0x10184', type: 'f', kind: 'range', label: 'Original level', min: 0.0, max: 1.0, step: 0.01, def: 1.0, digits: 2 },
      ],
    },
    {
      id: 'bassmono',
      title: 'Bass mono',
      desc: 'Sums bass to mono before enhancing it.',
      params: [
        { id: '0x10170', type: 'b', kind: 'bool', label: 'Enable bass mono', def: false },
        { id: '0x10171', type: 'i', kind: 'select', label: 'Mode', def: 0, options: [[0, 'Natural Bass'], [1, 'Pure Bass+'], [2, 'Subwoofer']] },
        { id: '0x10172', type: 'i', kind: 'range', label: 'Frequency', min: 15, max: 150, step: 1, def: 60, digits: 0, unit: 'Hz' },
        { id: '0x10173', type: 'f', kind: 'range', label: 'Gain', min: 0.5, max: 10.0, step: 0.05, def: 0.5, digits: 2 },
        { id: '0x10174', type: 'b', kind: 'bool', label: 'Anti-pop', def: false },
      ],
    },
    {
      id: 'cure',
      title: 'Cure (crossfeed)',
      desc: 'Blends the channels to reduce fatigue on headphones.',
      params: [
        { id: '0x10240', type: 'b', kind: 'bool', label: 'Enable cure', def: false },
        { id: '0x10241', type: 'i', kind: 'select', label: 'Strength', def: 0, options: [[0, 'Mild'], [1, 'Medium'], [2, 'Strong']] },
      ],
    },
    {
      id: 'analogx',
      title: 'AnalogX',
      desc: 'Analog-style saturation.',
      params: [
        { id: '0x10260', type: 'b', kind: 'bool', label: 'Enable AnalogX', def: false },
        { id: '0x10261', type: 'i', kind: 'select', label: 'Mode', def: 0, options: [[0, 'Mild'], [1, 'Medium'], [2, 'Strong']] },
      ],
    },
    {
      id: 'speaker',
      title: 'Speaker correction',
      desc: 'Corrects the speaker response.',
      params: [
        { id: '0x10270', type: 'b', kind: 'bool', label: 'Enable speaker correction', def: false },
      ],
    },
  ];

  const ALL_PARAMS = GROUPS.flatMap((g) => g.params);
  const BY_ID = new Map(ALL_PARAMS.map((p) => [p.id, p]));

  const state = new Map(); // id -> number | boolean (current DSP values)
  const els = {
    sections: document.getElementById('sections'),
    status: document.getElementById('status'),
    powerBtn: document.getElementById('powerBtn'),
    statusText: document.getElementById('statusText'),
    notice: document.getElementById('notice'),
    presetName: document.getElementById('presetName'),
    presetList: document.getElementById('presetList'),
    presetSave: document.getElementById('presetSave'),
    resetAll: document.getElementById('resetAll'),
    footerInfo: document.getElementById('footerInfo'),
    toast: document.getElementById('toast'),
  };

  const hasKsu = () => typeof window.ksu === 'object' && window.ksu !== null && typeof window.ksu.exec === 'function';

  // ---------- Shell bridge ----------

  let callbackSeq = 0;

  const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;

  // KernelSU delivers exec results to a named global callback.
  function runCtl(args) {
    return new Promise((resolve, reject) => {
      if (!hasKsu()) {
        reject(new Error('Preview mode: open from the KernelSU manager'));
        return;
      }
      const name = `__viperCb${++callbackSeq}`;
      const timer = setTimeout(() => {
        delete window[name];
        reject(new Error('Timed out talking to the module'));
      }, 15000);
      window[name] = (code, stdout, stderr) => {
        clearTimeout(timer);
        delete window[name];
        if (code === 0) resolve(stdout || '');
        else reject(new Error((stderr || stdout || `exit ${code}`).trim()));
      };
      const cmd = ['sh', CTL, ...args].map(shQuote).join(' ');
      try {
        window.ksu.exec(cmd, '{}', name);
      } catch (err) {
        clearTimeout(timer);
        delete window[name];
        reject(err);
      }
    });
  }

  // ---------- Feedback ----------

  let toastTimer = null;
  function toast(message, isError = false) {
    els.toast.textContent = message;
    els.toast.classList.toggle('is-error', isError);
    els.toast.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => els.toast.classList.remove('is-visible'), 2200);
  }

  function setStatus(kind, text) {
    els.status.classList.toggle('is-ok', kind === 'ok');
    els.status.classList.toggle('is-warn', kind === 'warn');
    els.statusText.textContent = text;
  }

  // ---------- Rendering ----------

  function fmt(value, p) {
    if (p.digits === 0) return `${Math.round(value)}${p.unit ? ` ${p.unit}` : ''}`;
    return Number(value).toFixed(p.digits ?? 2) + (p.unit ? ` ${p.unit}` : '');
  }

  function fillPct(p, value) {
    return ((value - p.min) / (p.max - p.min)) * 100;
  }

  function controlFor(p) {
    const wrap = document.createElement('div');
    wrap.className = `control${p.kind === 'range' ? ' control--range' : ''}`;
    wrap.dataset.param = p.id;

    const label = document.createElement('label');
    label.className = 'control__label';
    label.textContent = p.label;
    label.htmlFor = `ctl-${p.id}`;

    if (p.kind === 'bool') {
      const sw = document.createElement('label');
      sw.className = 'switch';
      sw.htmlFor = `ctl-${p.id}`;
      sw.innerHTML = `<input type="checkbox" id="ctl-${p.id}" /><span class="switch__track" aria-hidden="true"></span>`;
      const input = sw.querySelector('input');
      input.addEventListener('change', () => {
        state.set(p.id, input.checked);
        queueWrite(p.id);
      });
      wrap.append(label, sw);
    } else if (p.kind === 'select') {
      const select = document.createElement('select');
      select.className = 'select';
      select.id = `ctl-${p.id}`;
      for (const [val, text] of p.options) {
        const opt = document.createElement('option');
        opt.value = String(val);
        opt.textContent = text;
        select.append(opt);
      }
      select.addEventListener('change', () => {
        state.set(p.id, Number(select.value));
        queueWrite(p.id);
      });
      wrap.append(label, select);
    } else {
      const value = document.createElement('span');
      value.className = 'control__value';
      value.dataset.for = p.id;

      const row = document.createElement('div');
      row.className = 'control__row';
      row.style.gridColumn = '1 / -1';

      const range = document.createElement('input');
      range.type = 'range';
      range.id = `ctl-${p.id}`;
      range.min = String(p.min);
      range.max = String(p.max);
      range.step = String(p.step);

      range.addEventListener('input', () => {
        const v = Number(range.value);
        state.set(p.id, v);
        paintRange(range, p, v);
        value.textContent = fmt(v, p);
        queueWrite(p.id);
      });

      row.append(range);
      wrap.append(label, value, row);
      wrap.dataset.range = '1';
      wrap._range = range;
      wrap._value = value;
    }

    if (p.hint) {
      const hint = document.createElement('p');
      hint.className = 'control__hint';
      hint.textContent = p.hint;
      wrap.append(hint);
    }
    return wrap;
  }

  function paintRange(range, p, v) {
    range.style.setProperty('--fill', `${fillPct(p, v)}%`);
    range.value = String(v);
  }

  // A dropdown that writes several parameters at once, like the app's device presets.
  function devicePresetControl(presets) {
    const wrap = document.createElement('div');
    wrap.className = 'control';

    const label = document.createElement('label');
    label.className = 'control__label';
    label.textContent = 'Device preset';
    const select = document.createElement('select');
    select.className = 'select';
    select.id = 'ctl-devicePreset';
    label.htmlFor = select.id;
    select.append(new Option('Choose a preset…', ''));
    presets.forEach((preset, i) => select.append(new Option(preset.name, String(i))));

    select.addEventListener('change', () => {
      const preset = presets[Number(select.value)];
      select.value = '';
      if (!preset) return;
      for (const [id, value] of Object.entries(preset.values)) {
        state.set(id, value);
        queueWrite(id);
      }
      syncControls();
    });
    wrap.append(label, select);
    return wrap;
  }

  function renderSections() {
    els.sections.innerHTML = '';
    for (const g of GROUPS) {
      const card = document.createElement('section');
      card.className = 'card';
      card.setAttribute('aria-labelledby', `h-${g.id}`);

      const head = document.createElement('div');
      head.className = 'card__head';
      head.innerHTML = `<h2 id="h-${g.id}"></h2><p class="card__desc"></p>`;
      head.querySelector('h2').textContent = g.title;
      head.querySelector('.card__desc').textContent = g.desc;
      card.append(head);

      for (const p of g.params) card.append(controlFor(p));
      if (g.devicePresets) card.append(devicePresetControl(g.devicePresets));
      els.sections.append(card);
    }
  }

  // Push the in-memory state into the controls.
  function syncControls() {
    for (const p of ALL_PARAMS) {
      const v = state.has(p.id) ? state.get(p.id) : p.def;
      const wrap = document.querySelector(`.control[data-param="${p.id}"]`);
      if (!wrap) continue;
      if (p.kind === 'bool') {
        wrap.querySelector('input').checked = Boolean(v);
      } else if (p.kind === 'select') {
        wrap.querySelector('select').value = String(v);
      } else {
        paintRange(wrap._range, p, Number(v));
        wrap._value.textContent = fmt(Number(v), p);
      }
    }
  }

  function setDefaults() {
    state.clear();
    for (const p of ALL_PARAMS) state.set(p.id, p.def);
  }

  // ---------- Writes (serialized, debounced) ----------

  const pending = new Set();
  const timers = new Map();
  let flushing = false;

  function queueWrite(id) {
    if (!hasKsu()) return;
    pending.add(id);
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => {
      timers.delete(id);
      flush();
    }, WRITE_DEBOUNCE_MS));
  }

  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      while (pending.size) {
        const id = pending.values().next().value;
        pending.delete(id);
        const p = BY_ID.get(id);
        const [param, type, value] = entryFor(p, state.get(id)).split(' ');
        await runCtl(['set', param, type, value]);
      }
    } catch (err) {
      toast(err.message, true);
    } finally {
      flushing = false;
    }
  }

  // Encode one parameter as "<id> <type> <value>" for setmany.
  function entryFor(p, raw) {
    const value = p.type === 'b' ? (raw ? 1 : 0) : p.type === 'i' ? Math.round(Number(raw)) : Number(raw);
    return `${p.id} ${p.type} ${value}`;
  }

  // Write every parameter in one batch: one root shell, one publish.
  async function writeAll() {
    for (const id of pending) pending.delete(id);
    const blob = ALL_PARAMS.map((p) => entryFor(p, state.get(p.id))).join(';');
    await runCtl(['setmany', blob]);
  }

  // ---------- Status ----------

  function parseKV(text) {
    const out = {};
    for (const line of text.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return out;
  }

  async function refreshStatus() {
    if (!hasKsu()) {
      setStatus('warn', 'Preview mode');
      els.footerInfo.textContent = 'Preview — open from the KernelSU manager to apply changes';
      els.notice.hidden = false;
      return;
    }
    els.notice.hidden = true;
    try {
      const kv = parseKV(await runCtl(['status']));
      setPower(kv.power !== 'off');
      if (kv.patched !== 'yes') {
        setStatus('warn', 'Driver not patched — reboot');
      } else if (kv.power === 'off') {
        setStatus('warn', 'Off');
      } else if (kv.live === 'yes') {
        setStatus('ok', 'On');
      } else {
        setStatus('warn', 'Waiting for config');
      }
      els.footerInfo.textContent = kv.log && kv.log !== 'none' ? `Last log: ${kv.log}` : 'No driver log yet — play audio to start';
    } catch (err) {
      setStatus('warn', 'Module not reachable');
      els.footerInfo.textContent = err.message;
    }
  }

  // ---------- Power ----------

  function setPower(on) {
    els.powerBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  async function togglePower() {
    if (!hasKsu()) return;
    const next = els.powerBtn.getAttribute('aria-pressed') === 'true' ? 'off' : 'on';
    els.powerBtn.disabled = true;
    try {
      await runCtl(['power', next]);
      await refreshStatus();
    } catch (err) {
      setStatus('warn', 'Could not change power');
      els.footerInfo.textContent = err.message;
    } finally {
      els.powerBtn.disabled = false;
    }
  }

  // ---------- Load / config ----------

  async function loadCurrent() {
    setDefaults();
    if (!hasKsu()) {
      syncControls();
      return;
    }
    try {
      const text = await runCtl(['get']);
      for (const line of text.split('\n')) {
        const parts = line.trim().split(/\s+/);
        if (parts.length !== 3) continue;
        const [id, type, raw] = parts;
        const p = BY_ID.get(id.toLowerCase());
        if (!p || p.type !== type) continue;
        if (type === 'b') state.set(p.id, raw === '1');
        else if (type === 'i') state.set(p.id, parseInt(raw, 10));
        else state.set(p.id, parseFloat(raw));
      }
    } catch (err) {
      toast(err.message, true);
    }
    syncControls();
  }

  // ---------- Presets ----------

  function presetRow(name) {
    const li = document.createElement('li');
    const label = document.createElement('span');
    label.className = 'preset-name';
    label.textContent = name;

    const actions = document.createElement('div');
    actions.className = 'preset-actions';

    const load = document.createElement('button');
    load.className = 'button button--small button--filled';
    load.textContent = 'Load';
    load.addEventListener('click', () => loadPreset(name));

    const del = document.createElement('button');
    del.className = 'button button--small button--outlined-danger';
    del.textContent = 'Delete';
    del.addEventListener('click', () => deletePreset(name));

    actions.append(load, del);
    li.append(label, actions);
    return li;
  }

  async function refreshPresets() {
    els.presetList.innerHTML = '';
    if (!hasKsu()) {
      const empty = document.createElement('li');
      empty.className = 'preset-empty';
      empty.textContent = 'Presets appear here when the module is active.';
      els.presetList.append(empty);
      return;
    }
    try {
      const names = (await runCtl(['preset', 'list'])).split('\n').map((s) => s.trim()).filter(Boolean);
      if (!names.length) {
        const empty = document.createElement('li');
        empty.className = 'preset-empty';
        empty.textContent = 'No presets yet. Tune something and save it above.';
        els.presetList.append(empty);
        return;
      }
      for (const name of names) els.presetList.append(presetRow(name));
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function savePreset() {
    const name = els.presetName.value.trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) {
      toast('Use 1–32 letters, digits, - or _', true);
      return;
    }
    try {
      await flush();
      await runCtl(['preset', 'save', name]);
      els.presetName.value = '';
      toast(`Saved “${name}”`);
      refreshPresets();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function loadPreset(name) {
    try {
      await runCtl(['preset', 'load', name]);
      await loadCurrent();
      toast(`Loaded “${name}”`);
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function deletePreset(name) {
    try {
      await runCtl(['preset', 'delete', name]);
      toast(`Deleted “${name}”`);
      refreshPresets();
    } catch (err) {
      toast(err.message, true);
    }
  }

  async function resetAll() {
    try {
      // Write the defaults, not an empty file: the driver keeps the last
      // value it was given for any parameter that is not in the file.
      setDefaults();
      syncControls();
      await writeAll();
      toast('All effects reset to defaults');
    } catch (err) {
      toast(err.message, true);
    }
  }

  // ---------- Boot ----------

  els.presetSave.addEventListener('click', savePreset);
  els.presetName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') savePreset();
  });
  els.resetAll.addEventListener('click', resetAll);
  els.powerBtn.addEventListener('click', togglePower);

  renderSections();
  setDefaults();
  syncControls();
  refreshStatus().then(loadCurrent).then(refreshPresets);
})();
