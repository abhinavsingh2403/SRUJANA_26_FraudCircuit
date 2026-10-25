export default [{
  files: ['app.js', 'research.js', 'simulation.js'],
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module', globals: Object.fromEntries(['document','window','navigator','location','fetch','console','setTimeout','clearTimeout','setInterval','clearInterval','requestAnimationFrame','cancelAnimationFrame','performance','URL','URLSearchParams','Blob','AbortController','AbortSignal','IntersectionObserver','ResizeObserver','localStorage','sessionStorage','alert','confirm'].map(k=>[k,'readonly'])) },
  rules: {'no-undef':'error','no-dupe-keys':'error','no-unreachable':'error','valid-typeof':'error','no-constant-condition':'error'}
}];
