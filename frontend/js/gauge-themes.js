/* GhostTech Gauge Theme System
 * Three switchable themes for K-line live gauges.
 * Phantom Matrix (green/purple) | Titanium Stealth (ice blue/white) | Obsidian Bloodline (blood orange/gray)
 */

const GAUGE_THEMES = {
  phantom_matrix: {
    name: 'Phantom Matrix',
    description: 'Neon Green & Dark Purple — aggressive race feel',
    colors: {
      background: '#0a0a12',
      primary: '#00ff88',      // Neon green
      secondary: '#9933ff',    // Dark purple
      text: '#ffffff',
      textDim: '#888888',
      warning: '#ffaa00',
      danger: '#ff3333',
      gaugeTrack: '#1a1a2e',
      gaugeFill: '#00ff88',
    },
    gauges: ['rpm', 'boost', 'afr'],
  },
  titanium_stealth: {
    name: 'Titanium Stealth',
    description: 'Ice Blue & White — clean OEM+ professional',
    colors: {
      background: '#0d1117',
      primary: '#00d4ff',      // Ice blue
      secondary: '#ffffff',    // White
      text: '#ffffff',
      textDim: '#6e7681',
      warning: '#ffaa00',
      danger: '#ff3333',
      gaugeTrack: '#161b22',
      gaugeFill: '#00d4ff',
    },
    gauges: ['speed', 'coolant', 'intake_temp'],
  },
  obsidian_bloodline: {
    name: 'Obsidian Bloodline',
    description: 'Blood Orange & Ghost Gray — dark and menacing',
    colors: {
      background: '#0f0d0d',
      primary: '#ff4400',      // Blood orange
      secondary: '#8a8a8a',    // Ghost gray
      text: '#ffffff',
      textDim: '#666666',
      warning: '#ffaa00',
      danger: '#ff0000',
      gaugeTrack: '#1c1a1a',
      gaugeFill: '#ff4400',
    },
    gauges: ['boost_bar', 'rpm_gear', 'inj_duty', 'oil_press'],
  },
};

let activeTheme = 'phantom_matrix';

function setGaugeTheme(themeId) {
  if (!GAUGE_THEMES[themeId]) throw new Error('Unknown theme: ' + themeId);
  activeTheme = themeId;
  applyThemeToDOM(themeId);
  try { localStorage.setItem('ghosttech_gauge_theme', themeId); } catch(e) {}
  return GAUGE_THEMES[themeId];
}

function getActiveTheme() {
  return GAUGE_THEMES[activeTheme];
}

function applyThemeToDOM(themeId) {
  const theme = GAUGE_THEMES[themeId];
  const root = document.documentElement;
  if (!root) return;
  const c = theme.colors;
  root.style.setProperty('--gauge-bg', c.background);
  root.style.setProperty('--gauge-primary', c.primary);
  root.style.setProperty('--gauge-secondary', c.secondary);
  root.style.setProperty('--gauge-text', c.text);
  root.style.setProperty('--gauge-text-dim', c.textDim);
  root.style.setProperty('--gauge-warning', c.warning);
  root.style.setProperty('--gauge-danger', c.danger);
  root.style.setProperty('--gauge-track', c.gaugeTrack);
  root.style.setProperty('--gauge-fill', c.gaugeFill);
  document.body.setAttribute('data-gauge-theme', themeId);
}

function loadSavedTheme() {
  try {
    const saved = localStorage.getItem('ghosttech_gauge_theme');
    if (saved && GAUGE_THEMES[saved]) {
      activeTheme = saved;
    }
  } catch(e) {}
  return activeTheme;
}

// Render theme switcher buttons
function renderThemeSwitcher(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  
  container.innerHTML = Object.entries(GAUGE_THEMES).map(([id, theme]) => `
    <button class="theme-btn ${id === activeTheme ? 'active' : ''}" 
            data-theme="${id}"
            style="border-color: ${theme.colors.primary};">
      <span class="theme-name" style="color: ${theme.colors.primary};">${theme.name}</span>
      <span class="theme-desc">${theme.description}</span>
    </button>
  `).join('');
  
  container.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      setGaugeTheme(btn.dataset.theme);
      renderThemeSwitcher(containerId); // Re-render to update active state
    });
  });
}

if (typeof module !== 'undefined') {
  module.exports = { GAUGE_THEMES, setGaugeTheme, getActiveTheme, applyThemeToDOM, loadSavedTheme, renderThemeSwitcher };
}
