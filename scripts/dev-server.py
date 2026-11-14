"""Serveur local sans cache pour prévisualiser RelBrain (mode démo, sans /api).
Usage : python scripts/dev-server.py [dossier] [port]"""
import http.server, functools, sys, os
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
root = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
port = int(sys.argv[2] if len(sys.argv) > 2 else os.environ.get('PORT', 3000))
print(f'RelBrain : http://localhost:{port}', flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(H, directory=root)).serve_forever()
