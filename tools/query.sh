#!/bin/bash
# query.sh - Wiki 查询辅助脚本
# 用法: ./tools/query.sh <关键词>
# 功能: 在 wiki/ 目录中搜索包含关键词的页面

set -e

WIKI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIKI_DIR="$WIKI_ROOT/wiki"

if [ $# -eq 0 ]; then
    echo "用法: $0 <关键词> [关键词2 ...]"
    echo ""
    echo "在 Wiki 页面中搜索包含指定关键词的内容。"
    echo ""
    echo "选项:"
    echo "  -t, --title    仅搜索标题"
    echo "  -l, --list     仅列出匹配的文件名"
    exit 1
fi

TITLE_ONLY=false
LIST_ONLY=false

while [[ $# -gt 0 ]]; do
    case $1 in
        -t|--title)
            TITLE_ONLY=true
            shift
            ;;
        -l|--list)
            LIST_ONLY=true
            shift
            ;;
        *)
            KEYWORDS+=("$1")
            shift
            ;;
    esac
done

if [ ${#KEYWORDS[@]} -eq 0 ]; then
    echo "错误: 请提供至少一个关键词"
    exit 1
fi

PATTERN=$(IFS="|"; echo "${KEYWORDS[*]}")

echo "搜索: ${KEYWORDS[*]}"
echo "---"

if [ "$TITLE_ONLY" = true ]; then
    grep -rl "^title:.*\($PATTERN\)" "$WIKI_DIR" --include="*.md" 2>/dev/null | while read -r file; do
        title=$(grep "^title:" "$file" | head -1 | sed 's/title: //')
        echo "  $(basename "$file") - $title"
    done
elif [ "$LIST_ONLY" = true ]; then
    grep -rl "$PATTERN" "$WIKI_DIR" --include="*.md" 2>/dev/null | while read -r file; do
        echo "  $(basename "$file")"
    done
else
    grep -rn "$PATTERN" "$WIKI_DIR" --include="*.md" 2>/dev/null | while IFS=: read -r file line content; do
        relpath="${file#$WIKI_DIR/}"
        echo "  $relpath:$line: $content"
    done
fi

MATCH_COUNT=$(grep -rl "$PATTERN" "$WIKI_DIR" --include="*.md" 2>/dev/null | wc -l | tr -d ' ')
echo "---"
echo "共找到 $MATCH_COUNT 个匹配文件"
