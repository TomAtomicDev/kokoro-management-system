export type CalculatorOperator = "+" | "-" | "×" | "÷";

export type CalculatorEvaluation =
  | { value: number }
  | { error: "invalidExpression" | "divisionByZero" };

const operators = new Set<CalculatorOperator>(["+", "-", "×", "÷"]);

function tokenize(expression: string): string[] | null {
  const normalized = expression.replaceAll(",", ".").replaceAll(" ", "");
  if (normalized === "") return null;

  const tokens = normalized.match(/\d+(?:\.\d*)?|\.\d+|[+\-×÷]/g);
  if (!tokens || tokens.join("") !== normalized) return null;
  return tokens;
}

/** Evaluates the calculator's small four-operation expression language without using eval(). */
export function evaluateExpression(expression: string): CalculatorEvaluation {
  const tokenized = tokenize(expression);
  if (!tokenized) return { error: "invalidExpression" };
  const tokens: string[] = tokenized;

  let position = 0;

  function parsePrimary(): number | null {
    const token = tokens[position];
    if (!token) return null;

    if (token === "+" || token === "-") {
      position += 1;
      const value = parsePrimary();
      if (value === null) return null;
      return token === "-" ? -value : value;
    }

    if (operators.has(token as CalculatorOperator)) return null;
    position += 1;
    const value = Number(token);
    return Number.isFinite(value) ? value : null;
  }

  function parseTerm(): number | null {
    let value = parsePrimary();
    if (value === null) return null;

    while (position < tokens.length) {
      const operator = tokens[position];
      if (operator !== "×" && operator !== "÷") break;
      position += 1;
      const right = parsePrimary();
      if (right === null) return null;
      if (operator === "÷" && right === 0) throw new Error("divisionByZero");
      value = operator === "×" ? value * right : value / right;
      if (!Number.isFinite(value)) return null;
    }

    return value;
  }

  try {
    let value = parseTerm();
    if (value === null) return { error: "invalidExpression" };

    while (position < tokens.length) {
      const operator = tokens[position];
      if (operator !== "+" && operator !== "-") return { error: "invalidExpression" };
      position += 1;
      const right = parseTerm();
      if (right === null) return { error: "invalidExpression" };
      value = operator === "+" ? value + right : value - right;
      if (!Number.isFinite(value)) return { error: "invalidExpression" };
    }

    return { value };
  } catch (error) {
    if (error instanceof Error && error.message === "divisionByZero") {
      return { error: "divisionByZero" };
    }
    return { error: "invalidExpression" };
  }
}

export function formatCalculatorNumber(value: number): string {
  const safeValue = Object.is(value, -0) ? 0 : value;
  return new Intl.NumberFormat("es-BO", {
    maximumFractionDigits: 10,
    useGrouping: false,
  }).format(safeValue);
}
