#!/bin/bash
# lint.sh - Wiki 健康检查脚本
# 用法: ./tools/lint.sh
# 功能: 检查 Wiki 的健康状态，发现潜在问题

set -e

WIKI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WIKI_DIR="$WIKI_ROOT/wiki"

echo "=== LLM Wiki 健康检查 ==="
echo ""

echo "📊 统计信息"
echo "---"
TOTAL=$(find "$WIKI_DIR" -name "*.md" | wc -l | tr -d ' ')
ENTITIES=$(find "$WIKI_DIR/entities" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
CONCEPTS=$(find "$WIKI_DIR/concepts" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
SOURCES=$(find "$WIKI_DIR/sources" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
ANALYSES=$(find "$WIKI_DIR/analyses" -name "*.md" 2>/dev/null | wc -l | tr -d ' ')
RAW_COUNT=$(find "$WIKI_ROOT/raw" -name "*.md" -not -path "*/assets/*" 2>/dev/null | wc -l | tr -d ' ')

echo "  Wiki 页面总数: $TOTAL"
echo "  实体页面: $ENTITIES"
echo "  概念页面: $CONCEPTS"
echo "  来源摘要: $SOURCES"
echo "  分析页面: $ANALYSES"
echo "  原始资料: $RAW_COUNT"
echo ""

echo "🔗 链接检查"
echo "---"
BROKEN_LINKS=0
grep -roh '\[\[[^]]*\]\]' "$WIKI_DIR" --include="*.md" 2>/dev/null | sort -u | while read -r link; do
    target=$(echo "$link" | sed 's/\[\[//;s/\]\]//')
    if [[ "$target" == *"/"* ]]; then
        target_file="$WIKI_DIR/$target.md"
    else
        target_file=$(find "$WIKI_DIR" -name "$target.md" 2>/dev/null | head -1)
    fi
    if [ -z "$target_file" ] || [ ! -f "$target_file" ]; then
        echo "  ⚠️  断链: [[$target]]"
        BROKEN_LINKS=$((BROKEN_LINKS + 1))
    fi
done
if [ $BROKEN_LINKS -eq 0 ]; then
    echo "  ✓ 无断链"
fi
echo ""

echo "📄 孤立页面检查"
echo "---"
find "$WIKI_DIR" -name "*.md" -not -name "index.md" -not -name "log.md" -not -name "overview.md" | while read -r page; do
    pagename=$(basename "$page" .md)
    INBOUND=$(grep -rl "\[\[.*$pagename.*\]\]" "$WIKI_DIR" --include="*.md" 2>/dev/null | grep -v "$page" | wc -l | tr -d ' ')
    if [ "$INBOUND" -eq 0 ]; then
        echo "  ⚠️  孤立页面: $(basename "$page") (无入链)"
    fi
done
echo ""

echo "📋 Frontmatter 检查"
echo "---"
find "$WIKI_DIR" -name "*.md" -not -name "index.md" -not -name "log.md" | while read -r page; do
    if ! head -1 "$page" | grep -q "^---$"; then
        echo "  ⚠️  缺少 frontmatter: $(basename "$page")"
    fi
done
echo ""

echo "=== 检查完成 ==="
