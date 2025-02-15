import unicodedata


def convert_to_half_width(text: str) -> str:
    """
    NFKC正規化を行う
    Args:
        text (str): 正規化したいテキスト
    """
    return unicodedata.normalize("NFKC", text)
