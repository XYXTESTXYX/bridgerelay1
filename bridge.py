import os, sys, json, shutil, subprocess
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT = 8999
PROJECT_DIR = os.path.abspath(os.getcwd())
PROJECT_NAME = os.path.basename(PROJECT_DIR)
BACKUP_DIR = os.path.join(PROJECT_DIR, ".ai_backups")
EXCLUDE_DIRS = {".git", "node_modules", ".venv", "venv", "__pycache__", "dist", "build", ".next", ".cache", ".ai_backups"}

def open_in_vscode(abs_path, line=1):
    try:
        subprocess.Popen(["code", "-g", f"{abs_path}:{line}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        pass
    try:
        subprocess.Popen(["cmd", "/c", "start", f"vscode://file/{abs_path}:{line}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except Exception:
        return False

def find_file(filename):
    clean_path = filename.strip().replace("\\", "/").lstrip("/")
    direct = os.path.join(PROJECT_DIR, clean_path.replace("/", os.sep))
    if os.path.exists(direct):
        return clean_path, direct

    norm_target = clean_path.lower()
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            abs_p = os.path.join(root, f)
            rel_p = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")
            if rel_p.lower() == norm_target or rel_p.lower().endswith("/" + norm_target):
                return rel_p, abs_p

    base_target = os.path.basename(clean_path).lower()
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS]
        for f in files:
            if f.lower() == base_target:
                abs_p = os.path.join(root, f)
                return os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/"), abs_p

    return None, None

def backup_file(abs_path):
    try:
        os.makedirs(BACKUP_DIR, exist_ok=True)
        rel = os.path.relpath(abs_path, PROJECT_DIR).replace(os.sep, "_")
        ts = datetime.now().strftime("%Y%m%d_%H%M%S")
        dest = os.path.join(BACKUP_DIR, f"{ts}_{rel}")
        shutil.copy2(abs_path, dest)
    except Exception:
        pass

def replace_snippet_in_content(full_content, find_snip, new_snip):
    if find_snip in full_content:
        count = full_content.count(find_snip)
        pos = full_content.find(find_snip)
        line_no = full_content[:pos].count("\n") + 1
        updated = full_content.replace(find_snip, new_snip)
        return updated, line_no, count

    norm_full = full_content.replace("\r\n", "\n")
    norm_find = find_snip.replace("\r\n", "\n").strip()
    norm_new = new_snip.replace("\r\n", "\n")

    if norm_find in norm_full:
        count = norm_full.count(norm_find)
        pos = norm_full.find(norm_find)
        line_no = norm_full[:pos].count("\n") + 1
        updated = norm_full.replace(norm_find, norm_new)
        return updated, line_no, count

    find_lines = [l.strip() for l in norm_find.splitlines() if l.strip()]
    if find_lines:
        file_lines = norm_full.splitlines(keepends=True)
        first_line = find_lines[0]
        for idx, line in enumerate(file_lines):
            if first_line in line:
                match = True
                for j, f_line in enumerate(find_lines):
                    if idx + j >= len(file_lines) or f_line not in file_lines[idx + j]:
                        match = False
                        break
                if match:
                    line_no = idx + 1
                    prefix = "".join(file_lines[:idx])
                    suffix = "".join(file_lines[idx + len(find_lines):])
                    if not norm_new.endswith("\n"): norm_new += "\n"
                    return prefix + norm_new + suffix, line_no, 1

    return None, None, 0

def generate_digest():
    tree_lines = []
    file_count = 0
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        level = root.replace(PROJECT_DIR, "").count(os.sep)
        indent = "  " * level
        folder = os.path.basename(root)
        if level > 0:
            tree_lines.append(f"{indent}📁 {folder}/")
        for f in sorted(files):
            if not f.startswith("."):
                tree_lines.append(f"{indent}  📄 {f}")
                file_count += 1
                if file_count >= 120: break
        if file_count >= 120:
            tree_lines.append("  ... (truncated)")
            break
    return "\n".join(tree_lines), file_count

def get_project_files():
    file_list = []
    for root, dirs, files in os.walk(PROJECT_DIR):
        dirs[:] = [d for d in dirs if d not in EXCLUDE_DIRS and not d.startswith(".")]
        for f in sorted(files):
            if not f.startswith("."):
                abs_p = os.path.join(root, f)
                rel_p = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")
                file_list.append(rel_p)
                if len(file_list) >= 300: break
        if len(file_list) >= 300: break
    return file_list

class BridgeServer(ThreadingHTTPServer):
    allow_reuse_address = True

class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")

    def _json(self, status, payload):
        b = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self._cors()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        path_only = self.path.split("?")[0]
        if path_only == "/status":
            self._json(200, {"bridge": "ai-bridge", "status": "ok", "project": PROJECT_NAME, "root": PROJECT_DIR})
        elif path_only == "/digest":
            tree, count = generate_digest()
            self._json(200, {"bridge": "ai-bridge", "project": PROJECT_NAME, "tree": tree, "file_count": count})
        elif path_only == "/files":
            files = get_project_files()
            self._json(200, {"bridge": "ai-bridge", "project": PROJECT_NAME, "files": files, "count": len(files)})
        elif path_only == "/get_bridge_source":
            try:
                with open(__file__, "r", encoding="utf-8") as f:
                    src = f.read().encode("utf-8")
                self.send_response(200)
                self._cors()
                self.send_header("Content-Type", "text/x-python; charset=utf-8")
                self.send_header("Content-Length", str(len(src)))
                self.end_headers()
                self.wfile.write(src)
            except Exception:
                self._json(500, {"error": "Could not read source"})
        else:
            self._json(404, {"error": "Not found"})

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        path_only = self.path.split("?")[0]

        if path_only == "/find":
            rel, abs_p = find_file(body.get("filename", ""))
            if not rel: return self._json(200, {"bridge": "ai-bridge", "found": False})
            open_in_vscode(abs_p, 1)
            self._json(200, {"bridge": "ai-bridge", "found": True, "path": rel})

        elif path_only in ("/replace", "/create"):
            raw_path = body.get("path", "").strip()
            content = body.get("content", "")
            find_snip = body.get("find_snippet", None)

            rel, abs_p = find_file(raw_path)
            if not abs_p:
                abs_p = os.path.join(PROJECT_DIR, raw_path.lstrip("/\\"))
                rel = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")

            os.makedirs(os.path.dirname(abs_p) or PROJECT_DIR, exist_ok=True)

            if find_snip and os.path.exists(abs_p):
                backup_file(abs_p)
                with open(abs_p, "r", encoding="utf-8", errors="ignore") as f:
                    orig = f.read()
                updated, line_no, count = replace_snippet_in_content(orig, find_snip, content)
                if updated is not None:
                    with open(abs_p, "w", encoding="utf-8") as f:
                        f.write(updated)
                    open_in_vscode(abs_p, line_no)
                    return self._json(200, {"bridge": "ai-bridge", "success": True, "path": rel, "replaced_snippet": True, "count": count, "line": line_no})
                else:
                    return self._json(200, {"bridge": "ai-bridge", "success": False, "error": "Snippet not found in target file."})

            if os.path.exists(abs_p):
                with open(abs_p, "r", encoding="utf-8", errors="ignore") as f:
                    orig = f.read()
                orig_lines = len(orig.splitlines())
                new_lines = len(content.splitlines())
                is_full = any(content.strip().startswith(kw) for kw in ["import ", "export ", "<!DOCTYPE", "<?php", "package "])
                if orig_lines > 20 and new_lines <= 5 and not is_full:
                    return self._json(200, {
                        "bridge": "ai-bridge",
                        "success": False,
                        "error": f"Safety Guard: File has {orig_lines} lines. Refusing to overwrite full file with a {new_lines}-line snippet."
                    })

            backup_file(abs_p)
            with open(abs_p, "w", encoding="utf-8") as f:
                f.write(content)
            open_in_vscode(abs_p, 1)
            self._json(200, {"bridge": "ai-bridge", "success": True, "path": rel, "replaced_snippet": False})

        elif path_only == "/batch_replace":
            files = body.get("files", [])
            updated = []
            for item in files:
                p, c = item.get("path", "").strip(), item.get("content", "")
                if not p or not c: continue
                rel, abs_p = find_file(p)
                if not abs_p:
                    abs_p = os.path.join(PROJECT_DIR, p.lstrip("/\\"))
                    rel = os.path.relpath(abs_p, PROJECT_DIR).replace(os.sep, "/")
                os.makedirs(os.path.dirname(abs_p) or PROJECT_DIR, exist_ok=True)
                backup_file(abs_p)
                with open(abs_p, "w", encoding="utf-8") as f:
                    f.write(c)
                updated.append(rel)
                open_in_vscode(abs_p, 1)
            self._json(200, {"bridge": "ai-bridge", "success": True, "updated": len(updated), "files": updated})

        elif path_only == "/terminal":
            cmd = body.get("command", "").strip()
            try:
                subprocess.Popen(["code", PROJECT_DIR], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            except Exception:
                pass
            self._json(200, {"bridge": "ai-bridge", "success": True, "command": cmd})

def main():
    server = BridgeServer(("127.0.0.1", PORT), Handler)
    print(f"\n==========================================")
    print(f" [OK] AI Bridge Connected: {PROJECT_NAME}")
    print(f" [OK] Port: http://127.0.0.1:{PORT}")
    print(f"==========================================\n")
    server.serve_forever()

if __name__ == "__main__":
    main()
