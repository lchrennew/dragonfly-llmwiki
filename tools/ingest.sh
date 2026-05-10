#!/bin/bash
# ingest.sh - 资料摄入辅助脚本
# 用法: ./tools/ingest.sh <source_file>
# 功能: 将新的原始资料复制到 raw/ 目录并提示 LLM 进行处理

set -e

WIKI_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
RAW_DIR="$WIKI_ROOT/raw"

if [ $# -eq 0 ]; then
    echo "用法: $0 <source_file> [source_file2 ...]"
    echo ""
    echo "将源文件复制到 raw/ 目录，准备让 LLM 进行摄入处理。"
    echo "系统会自动检测文件是否有变化，只处理新增或修改的文件。"
    echo ""
    echo "支持的文件格式: .md, .txt, .pdf, .html"
    exit 1
fi

for file in "$@"; do
    if [ ! -f "$file" ]; then
        echo "错误: 文件不存在 - $file"
        continue
    fi

    filename=$(basename "$file")
    dest="$RAW_DIR/$filename"

    if [ -f "$dest" ]; then
        echo "警告: 文件已存在 - $dest"
        read -p "是否覆盖? (y/N) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            continue
        fi
    fi

    cp "$file" "$dest"
    echo "✓ 已添加: $filename -> raw/"
done

echo ""
echo "资料已就绪。请告诉 LLM 执行摄入操作："
echo "  \"请摄入 raw/ 中的新资料\""
echo ""
echo "提示: LLM 会自动检测文件变化，只处理有更新的文件。"
