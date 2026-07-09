import os

files_with_size = []
for root, dirs, files in os.walk('.'):
    # Exclude directories
    dirs[:] = [d for d in dirs if d not in ['node_modules', '.git', 'release', 'dist', 'out', '.agents', '.github', 'test-fixtures']]
    for file in files:
        if file.endswith('.exe') or file.endswith('.dll') or file.endswith('.dat') or file.endswith('.pak') or file.endswith('.bin'):
            continue
        path = os.path.join(root, file)
        files_with_size.append((path, os.path.getsize(path)))

files_with_size.sort(key=lambda x: x[1])
for f in files_with_size:
    print(f"{f[0]}: {f[1]} bytes")
