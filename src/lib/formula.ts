/**
 * Formules de score (mode avancé de la mise en vente) : « {prix} * {tdv} / 100 + {doublons} * 10 ».
 * Petit analyseur sans `eval` (interdit dans l'extension) : nombres, variables {nom}, + − * / % ^, comparaisons
 * (< <= > >= == !=, vrai = 1), && || !, parenthèses, fonctions min, max, abs, arrondi, plancher, plafond, racine,
 * log et si(condition, alors, sinon). Une variable inconnue de la carte vaut 0.
 */

export type FormulaVars = Record<string, number | null | undefined>;

/** Variables proposées pour le score d'une carte. */
export const FORMULA_VARS: { name: string; help: string }[] = [
  { name: 'prix', help: 'prix moyen de la carte (W)' },
  { name: 'prix_conseille', help: 'mise de départ du calcul par défaut (W)' },
  { name: 'tdv', help: 'taux de vente (0 à 100 ; 50 si inconnu)' },
  { name: 'confiance', help: 'confiance dans le taux de vente, de 0 (aucune enchère) à 1 (assez d\'enchères)' },
  { name: 'tdv_fiable', help: '1 si le taux de vente porte sur assez d\'enchères (Ventes → Taux de vente), sinon 0' },
  { name: 'ventes', help: 'enchères conclues de la carte' },
  { name: 'encheres', help: 'enchères terminées de la carte' },
  { name: 'quantite', help: 'exemplaires possédés' },
  { name: 'doublons', help: 'exemplaires en plus du premier' },
  { name: 'vendables', help: 'exemplaires vendables (après « garder »)' },
  { name: 'rarete', help: '1 (Commune) à 6 (Légendaire)' },
  { name: 'brillante', help: '1 si brillante, sinon 0' },
];

const FUNCTIONS: Record<string, { arity: [number, number]; fn: (...a: number[]) => number }> = {
  min: { arity: [1, 20], fn: Math.min },
  max: { arity: [1, 20], fn: Math.max },
  abs: { arity: [1, 1], fn: Math.abs },
  arrondi: { arity: [1, 1], fn: Math.round },
  plancher: { arity: [1, 1], fn: Math.floor },
  plafond: { arity: [1, 1], fn: Math.ceil },
  racine: { arity: [1, 1], fn: Math.sqrt },
  log: { arity: [1, 1], fn: Math.log10 },
  si: { arity: [3, 3], fn: (c, a, b) => (c ? a : b) },
};

export class FormulaError extends Error {
  constructor(message: string, readonly pos: number) {
    super(message);
  }
}

type Node = (vars: FormulaVars) => number;
type Token = { kind: 'num'; value: number; pos: number } | { kind: 'var' | 'name' | 'op'; value: string; pos: number };

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
    } else if (/[0-9.]/.test(c)) {
      // Nombre : 1.5 (la virgule sépare les arguments : max(1, 5)).
      const m = /^[0-9]*(?:\.[0-9]+)?/.exec(src.slice(i))![0];
      if (!m) throw new FormulaError('nombre invalide (décimales avec un point : 1.5)', i);
      out.push({ kind: 'num', value: Number(m), pos: i });
      i += m.length;
    } else if (c === '{') {
      const end = src.indexOf('}', i);
      if (end < 0) throw new FormulaError('« { » sans « } »', i);
      const name = src.slice(i + 1, end).trim().toLowerCase();
      if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw new FormulaError(`variable invalide « ${name} »`, i);
      out.push({ kind: 'var', value: name, pos: i });
      i = end + 1;
    } else if (/[a-zA-Z_]/.test(c)) {
      const m = /^[a-zA-Z_][a-zA-Z0-9_]*/.exec(src.slice(i))![0];
      out.push({ kind: 'name', value: m.toLowerCase(), pos: i });
      i += m.length;
    } else {
      const two = src.slice(i, i + 2);
      if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) {
        out.push({ kind: 'op', value: two, pos: i });
        i += 2;
      } else if ('+-*/%^()<>!,'.includes(c)) {
        out.push({ kind: 'op', value: c, pos: i });
        i++;
      } else {
        throw new FormulaError(`caractère inattendu « ${c} »`, i);
      }
    }
  }
  return out;
}

/** Compile une formule ; lève FormulaError (message en français, position) si elle est invalide. */
export function compileFormula(src: string): Node {
  const tokens = tokenize(src);
  if (!tokens.length) throw new FormulaError('formule vide', 0);
  let p = 0;
  const peek = () => tokens[p];
  const isOp = (v: string) => peek()?.kind === 'op' && peek()!.value === v;
  const expect = (v: string) => {
    if (!isOp(v)) throw new FormulaError(`« ${v} » attendu`, peek()?.pos ?? src.length);
    p++;
  };
  const binary = (next: () => Node, ops: Record<string, (a: number, b: number) => number>): (() => Node) => () => {
    let left = next();
    while (peek()?.kind === 'op' && peek()!.value in ops) {
      const f = ops[tokens[p++].value];
      const l = left;
      const r = next();
      left = (v) => f(l(v), r(v));
    }
    return left;
  };
  const primary = (): Node => {
    const t = peek();
    if (!t) throw new FormulaError('formule incomplète', src.length);
    p++;
    if (t.kind === 'num') return () => t.value;
    if (t.kind === 'var') return (v) => v[t.value] ?? 0;
    if (t.kind === 'name') {
      const fn = FUNCTIONS[t.value];
      if (!fn) throw new FormulaError(`fonction inconnue « ${t.value} » (variables entre accolades : {prix})`, t.pos);
      expect('(');
      const args: Node[] = [];
      if (!isOp(')')) {
        args.push(or());
        while (isOp(',')) {
          p++;
          args.push(or());
        }
      }
      expect(')');
      if (args.length < fn.arity[0] || args.length > fn.arity[1]) throw new FormulaError(`${t.value}() : mauvais nombre d'arguments`, t.pos);
      return (v) => fn.fn(...args.map((a) => a(v)));
    }
    if (t.value === '(') {
      const inner = or();
      expect(')');
      return inner;
    }
    if (t.value === '-') {
      const inner = power();
      return (v) => -inner(v);
    }
    if (t.value === '+') return power();
    if (t.value === '!') {
      const inner = power();
      return (v) => (inner(v) ? 0 : 1);
    }
    throw new FormulaError(`« ${t.value} » inattendu`, t.pos);
  };
  const power = (): Node => {
    const base = primary();
    if (isOp('^')) {
      p++;
      const exp = power();
      return (v) => base(v) ** exp(v);
    }
    return base;
  };
  const product = binary(power, { '*': (a, b) => a * b, '/': (a, b) => a / b, '%': (a, b) => a % b });
  const sum = binary(product, { '+': (a, b) => a + b, '-': (a, b) => a - b });
  const compare = binary(sum, { '<': (a, b) => +(a < b), '<=': (a, b) => +(a <= b), '>': (a, b) => +(a > b), '>=': (a, b) => +(a >= b), '==': (a, b) => +(a === b), '!=': (a, b) => +(a !== b) });
  const and = binary(compare, { '&&': (a, b) => +(!!a && !!b) });
  const or: () => Node = binary(and, { '||': (a, b) => +(!!a || !!b) });
  const root = or();
  if (p < tokens.length) throw new FormulaError(`« ${String(tokens[p].value)} » en trop`, tokens[p].pos);
  const used = tokens.filter((t) => t.kind === 'var').map((t) => t.value as string);
  const unknown = used.find((n) => !FORMULA_VARS.some((x) => x.name === n));
  if (unknown) throw new FormulaError(`variable inconnue {${unknown}}`, tokens.find((t) => t.kind === 'var' && t.value === unknown)!.pos);
  return root;
}

/** Erreur lisible d'une formule (null si elle est valide). */
export function formulaError(src: string): string | null {
  try {
    compileFormula(src);
    return null;
  } catch (e) {
    return e instanceof FormulaError ? `${e.message} (caractère ${e.pos + 1})` : String(e);
  }
}

const cache = new Map<string, Node | null>();

/** Score d'une formule (null : formule invalide ou résultat non fini). */
export function evalFormula(src: string, vars: FormulaVars): number | null {
  let node = cache.get(src);
  if (node === undefined) {
    try {
      node = compileFormula(src);
    } catch {
      node = null;
    }
    cache.set(src, node);
  }
  if (!node) return null;
  const r = node(vars);
  return Number.isFinite(r) ? r : null;
}
