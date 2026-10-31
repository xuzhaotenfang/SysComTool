"""``python -m syscomtool`` 的入口。"""

from .cli import main

if __name__ == "__main__":  # pragma: no cover - 进程入口
    raise SystemExit(main())
