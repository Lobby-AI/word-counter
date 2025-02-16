import plotly.graph_objects as go
import pandas as pd

from datetime import datetime
from functools import reduce
from typing import List

from src.models.word_counter import AllWordCount


def create_word_count_graph(results: List[AllWordCount], start_period: datetime, end_period: datetime):
    dfs = [
        pd.DataFrame(
            [{"speaker_name": count.speaker_name, result.word: count.count} for count in result.word_count_list]
        )
        for result in results
    ]
    merged_df = reduce(lambda left, right: pd.merge(left, right, on="speaker_name"), dfs)
    merged_df["total"] = merged_df.drop("speaker_name", axis=1).sum(axis=1)
    sorted_df = merged_df[merged_df["total"] > 0].sort_values("total", ascending=False)
    if len(sorted_df) == 0:
        return None
    # total列とspeaker_name列を除外した列を取得
    plot_columns = [col for col in sorted_df.columns if col not in ["total", "speaker_name"]]

    # グラフ作成
    fig = go.Figure()

    # 各列のデータを追加
    for column in plot_columns:
        fig.add_trace(
            go.Bar(
                name=column,
                x=sorted_df["speaker_name"],
                y=sorted_df[column],
            )
        )

    # レイアウトの設定
    fig.update_layout(
        barmode="stack",
        title="発言数の内訳",
        xaxis_title="発言者",
        yaxis_title="発言回数",
        showlegend=False,
    )
    return fig
