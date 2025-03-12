import streamlit as st

from datetime import datetime
from typing import List, Tuple

from src.counter.counter import WordCounter
from src.models.word_counter import AllStatementsContainsWord, AllWordCount
from src.ui.components import create_search_form
from src.ui.visualization import Visualizer
from src.utils.logger import setup_logger
from src.utils.process_str import convert_to_half_width


logger = setup_logger()

PICKLE_PATH = "pickle/shibuya/all_minutes_shibuya.pickle"

counter = WordCounter(PICKLE_PATH, logger)
visualizer = Visualizer()


def main():
    st.title("発言カウント")

    with st.sidebar:
        search_words, start_period, end_period = create_search_form()
        if start_period > end_period:
            st.warning("開始日は終了日以前に設定して下さい設定して下さい。")
            return
        # 検索ボタン
        search_button = st.button("検索")
    if search_button and search_words:
        start_datetime = datetime.combine(start_period, datetime.min.time())
        end_datetime = datetime.combine(end_period, datetime.max.time())

        try:
            # 入力された単語を,で区切り、全角を半角に直して検索
            results: List[Tuple[AllWordCount, AllStatementsContainsWord]] = [
                counter.count_word_witin_period(
                    convert_to_half_width(search_word).strip(), start_datetime, end_datetime
                )
                for search_word in set(search_words.split(","))
            ]
            # 結果に発言データが存在しなければ対象期間に議事録が存在しない
            if len(results[0][0].word_count_list) == 0:
                st.warning(
                    f"{start_period.strftime('%Y/%m/%d')}から{end_period.strftime('%Y/%m/%d')}の期間に議事録が存在しません。"
                )
                return
            st.header(f"「{search_words}」の発言回数")

            fig, statements_table_data_list = visualizer.create_word_count_graph_and_statements_tables(results)
            if fig is None:
                st.warning("対象の発言はありませんでした。")
                return
            st.plotly_chart(fig)
            for statemene_table_data in statements_table_data_list:
                with st.expander(f"「{statemene_table_data.word}」を含む発言"):
                    st.write(statemene_table_data.to_dataframe())

        except Exception as e:
            st.error(f"エラーが発生しました: {str(e)}")

    elif search_button:
        st.warning("検索する単語を入力してください。")


if __name__ == "__main__":
    main()
