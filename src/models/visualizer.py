import pandas as pd

from pydantic import BaseModel
from typing import Dict, List


class StatementsTableData(BaseModel):
    word: str
    data: List[Dict[str, str]]  # または適切な型を指定

    # DataFrameへの変換メソッド
    def to_dataframe(self) -> pd.DataFrame:
        return pd.DataFrame(self.data)

    # DataFrameからの変換メソッド
    @classmethod
    def from_dataframe(cls, word: str, df: pd.DataFrame):
        return cls(word=word, data=df.to_dict("records"))
