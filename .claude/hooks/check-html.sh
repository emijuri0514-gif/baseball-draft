#!/bin/bash
# HTML編集後の簡易チェック（タグバランス＋インラインscriptの構文）。
# ブロックはしない（index.htmlのタグチェックは巨大SPAゆえの誤検知があるため、常に参考情報として出す）。
set -u

INPUT=$(cat)
FILE=$(echo "$INPUT" | jq -r '.tool_input.file_path // .tool_response.filePath // empty' 2>/dev/null)

[[ -z "$FILE" ]] && exit 0
[[ "$FILE" != *.html ]] && exit 0
[[ ! -f "$FILE" ]] && exit 0

TAG_RESULT=$(python3 - "$FILE" <<'PYEOF'
import re, sys
f = sys.argv[1]
html = open(f, encoding='utf-8').read()
void_tags = {'img','br','hr','meta','link','input'}
stack = []
for m in re.finditer(r'<(/?)([a-zA-Z0-9]+)([^>]*)>', html):
    closing, tag, attrs = m.groups()
    tag = tag.lower()
    if tag in void_tags or attrs.strip().endswith('/'):
        continue
    if not closing:
        stack.append(tag)
    else:
        if not stack or stack[-1] != tag:
            print(f"MISMATCH at </{tag}> (stack top: {stack[-1] if stack else None})")
            sys.exit(0)
        stack.pop()
print("UNCLOSED: " + ",".join(stack) if stack else "OK")
PYEOF
)

JS_RESULT=$(node -e '
const fs = require("fs");
const html = fs.readFileSync(process.argv[1], "utf8");
const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
let m, i = 0, fails = [];
while ((m = re.exec(html))) {
  i++;
  const attrs = m[1], code = m[2];
  if (/\bsrc\s*=/.test(attrs)) continue;
  if (/type\s*=\s*["'"'"']application\/ld\+json["'"'"']/.test(attrs)) continue;
  try { new Function(code); }
  catch (e) { fails.push("script " + i + ": " + e.message.slice(0, 150)); }
}
console.log(fails.length ? fails.join(" | ") : "OK");
' "$FILE" 2>&1)

if [[ "$TAG_RESULT" != "OK" || "$JS_RESULT" != "OK" ]]; then
  MSG="⚠️ $(basename "$FILE") 編集後チェック — タグバランス: ${TAG_RESULT} ／ JS構文: ${JS_RESULT}"
  echo "{\"systemMessage\": $(printf '%s' "$MSG" | jq -Rs .)}"
fi
