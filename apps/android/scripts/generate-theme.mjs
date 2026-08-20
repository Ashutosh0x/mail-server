/* Emit Kotlin Color constants from packages/ui/src/theme.css.
   Light block = ":root {" at the top; dark block = ':root[data-theme="dark"]'. */
import { readFileSync } from 'node:fs';

function toHex(L, C, h, alpha = 1) {
    const hr = (h * Math.PI) / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.2914855480 * b) ** 3;
    const lin = [
         4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
        -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
        -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
    const enc = (u) => Math.max(0, Math.min(255, Math.round(
        (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(u, 1 / 2.4) - 0.055) * 255)));
    const hx = (n) => n.toString(16).padStart(2, '0').toUpperCase();
    return `0x${hx(Math.round(alpha * 255))}${lin.map(v => hx(enc(v))).join('')}`;
}

const css = readFileSync(process.argv[2], 'utf8');
const lines = css.split('\n');

function block(startPredicate) {
    const start = lines.findIndex(startPredicate);
    if (start < 0) return [];
    const out = [];
    for (let i = start + 1; i < lines.length; i++) {
        if (/^\s*\}/.test(lines[i])) break;
        const m = /^\s*(--[a-z0-9-]+):\s*oklch\(\s*([\d.]+)%\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)/.exec(lines[i]);
        if (m) out.push({ name: m[1], hex: toHex(+m[2] / 100, +m[3], +m[4], m[5] ? +m[5] : 1) });
    }
    return out;
}

const light = block(l => /^@theme\s*\{/.test(l));
const dark  = block(l => /^:root\[data-theme="dark"\]\s*\{/.test(l));

const camel = (n) => n.replace(/^--color-/, '').replace(/^--/, '')
    .replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());

const darkMap = new Map(dark.map(t => [t.name, t.hex]));
console.log(`light tokens: ${light.length}, dark overrides: ${dark.length}`);
console.log(JSON.stringify({ light, dark: [...darkMap] }, null, 0).slice(0, 0));

let out = '';
for (const t of light) {
    out += `val ${camel(t.name)}Light = Color(${t.hex})\n`;
}
out += '\n';
for (const t of light) {
    out += `val ${camel(t.name)}Dark = Color(${darkMap.get(t.name) ?? t.hex})\n`;
}
process.stdout.write('---KOTLIN---\n' + out);
