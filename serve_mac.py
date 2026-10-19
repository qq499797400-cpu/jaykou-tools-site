#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""嘉Jaykou工具台 · macOS/通用本地服务（零依赖，仅用标准库）

必须走 http 而不能双击 index.html：
浏览器在 file:// 协议下拒绝加载 WebAssembly，
视频压缩 / 格式转换 / 音频处理 / 3D 预览 / AI 类工具会全部失效。
"""
import http.server
import socketserver
import sys
import os

ROOT = os.path.dirname(os.path.abspath(__file__))
try:
    PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8080
except ValueError:
    PORT = 8080


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Cross-Origin-Opener-Policy', 'same-origin')
        self.send_header('Cross-Origin-Embedder-Policy', 'require-corp')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass


# 补 MIME：wasm 若被当成下载流，ffmpeg 类工具会直接加载失败
http.server.SimpleHTTPRequestHandler.extensions_map.update({
    '.wasm':  'application/wasm',
    '.mjs':   'text/javascript',
    '.js':    'text/javascript',
    '.json':  'application/json',
    '.woff2': 'font/woff2',
    '.woff':  'font/woff',
    '.ttf':   'font/ttf',
    '.glb':   'model/gltf-binary',
    '.gltf':  'model/gltf+json',
    '.data':  'application/octet-stream',
})

socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(('127.0.0.1', PORT), Handler) as httpd:
    print('  嘉Jaykou工具台  http://127.0.0.1:%d' % PORT)
    print('  目录: %s' % ROOT)
    print('  Ctrl+C 停止')
    print('')
    httpd.serve_forever()
