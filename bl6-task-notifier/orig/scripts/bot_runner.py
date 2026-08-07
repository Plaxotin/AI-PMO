import os, signal, sys

# Проверяем, запущен ли уже бот (по PID файлу)
pid_file = os.path.join(os.path.dirname(__file__), '.telegram_bot.pid')

if os.path.exists(pid_file):
    try:
        with open(pid_file, 'r') as f:
            old_pid = int(f.read().strip())
        os.kill(old_pid, 0)
        print(f"WARNING: Bot already running (PID {old_pid})")
        sys.exit(1)
    except (ProcessLookupError, ValueError, OSError):
        pass

# Сохраняем PID
with open(pid_file, 'w') as f:
    f.write(str(os.getpid()))

try:
    # Импортируем и запускаем
    import sys
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    from bot_handler import main_loop
    main_loop()
finally:
    if os.path.exists(pid_file):
        os.remove(pid_file)
