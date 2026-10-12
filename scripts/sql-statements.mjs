// Splits a SQL script into single statements without a database connection.
// Needed because CREATE INDEX CONCURRENTLY cannot run inside a transaction or a multi-statement query.
// Understands: -- line comments, /* block comments (nested) */, 'strings' (with '' escape), "identifiers",
// and $tag$ dollar-quoted bodies (DO blocks, functions), so semicolons inside those do not split.
// Comments outside quotes are dropped; comment-only fragments produce no statement.

export function splitSqlStatements(script) {
  const statements = [];
  let current = "";
  let i = 0;
  const n = script.length;

  const flush = () => {
    const text = current.trim();
    if (text) statements.push(text);
    current = "";
  };

  while (i < n) {
    const ch = script[i];
    const next = script[i + 1];

    if (ch === "-" && next === "-") {
      while (i < n && script[i] !== "\n") i++;
      continue;
    }

    if (ch === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (script[i] === "/" && script[i + 1] === "*") {
          depth++;
          i += 2;
        } else if (script[i] === "*" && script[i + 1] === "/") {
          depth--;
          i += 2;
        } else {
          i++;
        }
      }
      current += " ";
      continue;
    }

    if (ch === "'" || ch === '"') {
      const quote = ch;
      current += ch;
      i++;
      while (i < n) {
        current += script[i];
        if (script[i] === quote) {
          if (script[i + 1] === quote) {
            current += script[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }

    if (ch === "$") {
      const match = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(script.slice(i, i + 64));
      if (match) {
        const tag = match[0];
        const end = script.indexOf(tag, i + tag.length);
        if (end === -1) {
          throw new Error(`Unterminated dollar-quoted block ${tag}`);
        }
        current += script.slice(i, end + tag.length);
        i = end + tag.length;
        continue;
      }
    }

    if (ch === ";") {
      flush();
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  flush();
  return statements;
}
