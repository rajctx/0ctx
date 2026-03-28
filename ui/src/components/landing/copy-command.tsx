"use client";

import { useState, useCallback } from "react";

export function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(command);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [command]);

  return (
    <button onClick={copy} className="install-block" title="Copy to clipboard">
      <span className="install-prompt">$</span>
      <span className="install-command">{command}</span>
      <span className="install-copy">{copied ? "copied" : "copy"}</span>
    </button>
  );
}
