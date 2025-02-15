import logging

from pathlib import Path
from datetime import datetime


def setup_logger(log_dir: str = "logs"):
    # ロガーの取得
    logger = logging.getLogger(__name__)

    # ログレベルの設定
    logger.setLevel(logging.DEBUG)

    # ログディレクトリの作成
    Path(log_dir).mkdir(exist_ok=True)

    # ファイル出力の設定
    file_handler = logging.FileHandler(f"{log_dir}/app_{datetime.now():%Y%m%d_%H%M%S}.log")
    file_handler.setLevel(logging.DEBUG)

    # 標準出力へのハンドラ
    stream_handler = logging.StreamHandler()
    stream_handler.setLevel(logging.INFO)

    # フォーマットの設定
    formatter = logging.Formatter("%(asctime)s - %(name)s - %(levelname)s - %(message)s")
    stream_handler.setFormatter(formatter)
    stream_handler.setFormatter(formatter)

    # ハンドラの追加
    logger.addHandler(stream_handler)
    # logger.addHandler(file_handler)

    return logger
