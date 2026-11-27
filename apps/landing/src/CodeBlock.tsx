import type { ReactNode } from "react";

type Language = "json" | "yaml" | "bash";

function highlightJsonLine(line: string, lineIndex: number): ReactNode {
  const keyMatch = /^(\s*)("[^"]+")(:)(.*)$/.exec(line);
  if (keyMatch) {
    const [, indent, key, colon, rest = ""] = keyMatch;
    return (
      <span key={lineIndex}>
        {indent}
        <span className="syn-key">{key}</span>
        <span className="syn-punc">{colon}</span>
        {highlightJsonValue(rest)}
        {"\n"}
      </span>
    );
  }
  return (
    <span key={lineIndex}>
      {highlightJsonValue(line)}
      {"\n"}
    </span>
  );
}

function highlightJsonValue(value: string): ReactNode {
  const tokens: ReactNode[] = [];
  const pattern = /("[^"]*"|\btrue\b|\bfalse\b|\bnull\b|-?\d+(?:\.\d+)?)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let part = 0;

  while ((match = pattern.exec(value)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(value.slice(lastIndex, match.index));
    }
    const token = match[0];
    const cls = token.startsWith('"')
      ? "syn-str"
      : token === "true" || token === "false" || token === "null"
        ? "syn-kw"
        : "syn-num";
    tokens.push(
      <span key={part++} className={cls}>
        {token}
      </span>,
    );
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < value.length) {
    tokens.push(value.slice(lastIndex));
  }
  return tokens;
}

function highlightYamlLine(line: string, lineIndex: number): ReactNode {
  if (/^\s*#/.test(line)) {
    return (
      <span key={lineIndex} className="syn-com">
        {line}
        {"\n"}
      </span>
    );
  }
  const kvMatch = /^(\s*(?:-\s+)?)([a-zA-Z0-9_]+)(:)(.*)$/.exec(line);
  if (kvMatch) {
    const [, prefix, key, colon, rest = ""] = kvMatch;
    const trimmed = rest.trim();
    const valClass =
      trimmed.startsWith('"') || trimmed.startsWith("http")
        ? "syn-str"
        : trimmed === "true" || trimmed === "false" || trimmed === "deny"
          ? "syn-kw"
          : /^\d+(?:\.\d+)?$/.test(trimmed)
            ? "syn-num"
            : "syn-val";
    return (
      <span key={lineIndex}>
        <span className="syn-punc">{prefix}</span>
        <span className="syn-key">{key}</span>
        <span className="syn-punc">{colon}</span>
        <span className={valClass}>{rest}</span>
        {"\n"}
      </span>
    );
  }
  return (
    <span key={lineIndex}>
      {line}
      {"\n"}
    </span>
  );
}

function highlightBashLine(line: string, lineIndex: number): ReactNode {
  if (/^\s*#/.test(line)) {
    return (
      <span key={lineIndex} className="syn-com">
        {line}
        {"\n"}
      </span>
    );
  }
  if (!line.trim()) {
    return <span key={lineIndex}>{"\n"}</span>;
  }
  const cmdMatch = /^(\s*)([^\s]+)(.*)$/.exec(line);
  if (cmdMatch) {
    const [, indent, cmd, rest = ""] = cmdMatch;
    return (
      <span key={lineIndex}>
        {indent}
        <span className="syn-punc">$ </span>
        <span className="syn-key">{cmd}</span>
        <span className="syn-str">{rest}</span>
        {"\n"}
      </span>
    );
  }
  return (
    <span key={lineIndex}>
      {line}
      {"\n"}
    </span>
  );
}

export function CodeBlock({ code, lang }: { code: string; lang: Language }) {
  const lines = code.split("\n");
  return (
    <pre className="code-pre">
      <code>
        {lines.map((line, idx) =>
          lang === "json"
            ? highlightJsonLine(line, idx)
            : lang === "yaml"
              ? highlightYamlLine(line, idx)
              : highlightBashLine(line, idx),
        )}
      </code>
    </pre>
  );
}
