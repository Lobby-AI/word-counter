import plotly.express as px
import pandas as pd

from datetime import datetime

from src.models.word_counter import AllWordCount


def create_word_count_graph(result: AllWordCount, start_period: datetime, end_period: datetime):
    df = pd.DataFrame([{"speaker_name": count.speaker_name, "count": count.count} for count in result.word_count_list])
    df_sorted = df[df["count"] > 0].sort_values("count", ascending=False)
    if len(df_sorted) == 0:
        return None
    fig = px.bar(
        df_sorted,
        x="speaker_name",
        y="count",
        title=f"期間: {start_period.strftime('%Y/%m/%d')} - {end_period.strftime('%Y/%m/%d')}",
        labels={"speaker_name": "発言者", "count": "発言回数"},
    )
    # グラフのレイアウト調整
    fig.update_layout(
        showlegend=False,
        xaxis_title="発言者",
        yaxis_title="発言回数",
    )
    return fig
