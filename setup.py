from setuptools import setup, find_packages

setup(
    name="word_counter",
    version="0.1.0",
    packages=find_packages(),
    install_requires=["streamlit", "pandas", "pydantic"],
)
