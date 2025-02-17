import plotly.graph_objects as go
import pandas as pd

from datetime import datetime
from functools import reduce
from typing import List, Tuple

from src.models.visualizer import StatementsTableData
from src.models.word_counter import AllStatementsContainsWord, AllWordCount


class Visualizer:
    def __init__(self):
        pass

    def create_word_count_graph(self, results: List[AllWordCount]):
        """
        発言回数の積み上げグラフを作成する
        Args:
            results (List[AllWordCount]): 単語カウントデータのリスト
        """
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
            showlegend=True,
        )
        return fig

    def create_statements_df(self, all_statements_contain_word: AllStatementsContainsWord):
        """
        検索単語を含む発言のDataFrameを作成する
        Args:
            all_statements_contain_word (AllStatementsCountainsWord): 検索単語を含む全発言のデータ
        """
        rows = [
            {"発言者名": statements.speaker_name, "発言": content}
            for statements in all_statements_contain_word.all_statements.statements_list
            for content in statements.statement_contents
        ]
        df = pd.DataFrame(rows)
        return df

    def create_word_count_graph_and_statements_tables(
        self, results: List[Tuple[AllWordCount, AllStatementsContainsWord]]
    ):
        """
        発言回数の積み上げグラフと検索単語を含む発言のDataFrameを作成する
        Args:
            results (List[Tuple[AllWordCount, AllStatementsCountainsWord]]): 単語カウントの処理結果
        """
        # 発言回数の積み上げグラフを作成する
        word_count_results = [result[0] for result in results]
        fig = self.create_word_count_graph(word_count_results)

        # 検索単語を含む発言のテーブルを作成する
        statements_table_data_list = [
            StatementsTableData.from_dataframe(word=result[1].word, df=self.create_statements_df(result[1]))
            for result in results
        ]

        return fig, statements_table_data_list
