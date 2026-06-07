import os
import sys
from pathlib import Path
from dotenv import load_dotenv
from llama_parse import LlamaParse

load_dotenv()

RAW_DOCS_DIR = Path("raw_docs")
DOCS_DIR = Path("docs")

SUPPORTED = {".pdf", ".docx", ".pptx", ".html", ".txt"}


def parse_to_markdown(file_path: Path, parser: LlamaParse) -> str:
    documents = parser.load_data(str(file_path))
    return "\n\n".join(doc.text for doc in documents)


def generate_markdown(source_dir: Path = RAW_DOCS_DIR, output_dir: Path = DOCS_DIR) -> None:
    output_dir.mkdir(exist_ok=True)
    files = [f for f in source_dir.iterdir() if f.is_file() and f.suffix.lower() in SUPPORTED]

    if not files:
        print(f"No supported files found in '{source_dir}'. Supported: {SUPPORTED}")
        return

    parser = LlamaParse(
        api_key=os.environ["LLAMA_CLOUD_API_KEY"],
        result_type="markdown",
        verbose=True,
    )

    for file in files:
        print(f"\nParsing: {file.name}")
        markdown = parse_to_markdown(file, parser)
        out_path = output_dir / (file.stem + ".md")
        out_path.write_text(markdown, encoding="utf-8")
        print(f"Saved markdown → {out_path}")

    print("\nAll files parsed. Starting ingestion...")
    from ingest import ingest
    ingest(output_dir)


def parse_file(file_path: Path, output_dir: Path = DOCS_DIR) -> Path:
    """Parse a single file to markdown and return the output path."""
    output_dir.mkdir(exist_ok=True)
    parser = LlamaParse(
        api_key=os.environ["LLAMA_CLOUD_API_KEY"],
        result_type="markdown",
        verbose=False,
    )
    markdown = parse_to_markdown(file_path, parser)
    out_path = output_dir / (file_path.stem + ".md")
    out_path.write_text(markdown, encoding="utf-8")
    return out_path


if __name__ == "__main__":
    source = Path(sys.argv[1]) if len(sys.argv) > 1 else RAW_DOCS_DIR
    generate_markdown(source_dir=source)
