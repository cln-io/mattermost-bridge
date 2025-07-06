#!/bin/bash

echo "🔍 Debug Build Process"
echo ""

echo "📁 Current directory:"
pwd
echo ""

echo "📁 Source files in src/:"
ls -la src/ 2>/dev/null || echo "src/ directory doesn't exist!"
echo ""

echo "🔍 Looking for test.ts specifically:"
if [ -f "src/test.ts" ]; then
    echo "✅ src/test.ts exists"
    echo "First few lines:"
    head -5 src/test.ts
else
    echo "❌ src/test.ts NOT found"
fi
echo ""

echo "🔍 TypeScript and ts-node versions:"
npx tsc --version
npx ts-node --version
echo ""

echo "🧪 Testing ts-node directly:"
if [ -f "src/test.ts" ]; then
    echo "Running: npx ts-node src/test.ts"
    npx ts-node src/test.ts
else
    echo "❌ Cannot test - src/test.ts doesn't exist"
    echo ""
    echo "📋 Available files in src/:"
    find src/ -name "*.ts" 2>/dev/null || echo "No .ts files found"
fi