import os

from cauce.env import load_project_env


def test_load_project_env_reads_dotenv_without_overriding_process(tmp_path, monkeypatch):
    dotenv = tmp_path / ".env"
    dotenv.write_text("# comentario\nGEMINI_API_KEY='clave de prueba'\nCAUCE_VISION_PROVIDER=gemini\n", encoding="utf-8")
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("CAUCE_VISION_PROVIDER", "from-process")
    load_project_env(dotenv)
    assert os.environ["GEMINI_API_KEY"] == "clave de prueba"
    assert os.environ["CAUCE_VISION_PROVIDER"] == "from-process"
