#!/usr/bin/env ruby
# 嘉Jaykou工具台 · macOS 兜底服务（无 python3 时使用）
require 'webrick'
require 'webrick/httpservlet/filehandler'

PORT = (ARGV[0] || 8080).to_i
ROOT = File.expand_path(__dir__)

# 补 MIME，否则 wasm 会被当二进制下载，ffmpeg 类工具加载失败
WEBrick::HTTPServlet::FileHandler.add_handler('wasm',  'application/wasm')
WEBrick::HTTPServlet::FileHandler.add_handler('mjs',   'text/javascript')
WEBrick::HTTPServlet::FileHandler.add_handler('woff2', 'font/woff2')
WEBrick::HTTPServlet::FileHandler.add_handler('glb',   'model/gltf-binary')

server = WEBrick::HTTPServer.new(
  Port: PORT,
  DocumentRoot: ROOT,
  Logger: WEBrick::Log.new(File::NULL),
  AccessLog: []
)

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

puts ''
puts "  嘉Jaykou工具台  http://localhost:#{PORT}/"
puts "  目录: #{ROOT}"
puts '  Ctrl+C 停止'
puts ''

server.start
