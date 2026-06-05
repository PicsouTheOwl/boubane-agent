"""File analyzer — extracts text and generates summaries"""
import asyncio
from pathlib import Path
from typing import Optional


class FileAnalyzer:
    """Analyzes files: PDF, DOCX, XLSX, images, text"""
    
    async def analyze(self, file_path: str, ext: str) -> dict:
        """Analyze a file and return summary + extracted text"""
        path = Path(file_path)
        
        if not path.exists():
            return {"summary": "File not found", "text": "", "tags": []}
        
        ext = ext.lower()
        
        try:
            if ext == ".pdf":
                return await self._analyze_pdf(path)
            elif ext in (".docx", ".doc"):
                return await self._analyze_docx(path)
            elif ext in (".xlsx", ".xls"):
                return await self._analyze_xlsx(path)
            elif ext == ".csv":
                return await self._analyze_csv(path)
            elif ext in (".png", ".jpg", ".jpeg", ".webp"):
                return await self._analyze_image(path)
            elif ext in (".txt", ".md"):
                return await self._analyze_text(path)
            else:
                return {"summary": f"Unsupported type: {ext}", "text": "", "tags": []}
        except Exception as e:
            return {"summary": f"Analysis error: {e}", "text": "", "tags": ["error"]}
    
    async def _analyze_pdf(self, path: Path) -> dict:
        """Extract text from PDF"""
        try:
            import fitz  # PyMuPDF
            doc = fitz.open(str(path))
            text_parts = []
            for page in doc:
                text_parts.append(page.get_text())
            full_text = "\n".join(text_parts)
            doc.close()
            
            summary = self._generate_summary(full_text, "PDF")
            tags = self._detect_tags(full_text, ["pdf", "document"])
            return {"summary": summary, "text": full_text[:30000], "tags": tags}
        except ImportError:
            return {"summary": "PyMuPDF not installed. Run: pip install pymupdf", "text": "", "tags": ["pdf"]}
    
    async def _analyze_docx(self, path: Path) -> dict:
        """Extract text from DOCX"""
        try:
            from docx import Document
            doc = Document(str(path))
            paragraphs = [p.text for p in doc.paragraphs if p.text.strip()]
            full_text = "\n".join(paragraphs)
            
            # Also extract tables
            table_text = []
            for table in doc.tables:
                for row in table.rows:
                    row_text = " | ".join(cell.text for cell in row.cells)
                    table_text.append(row_text)
            if table_text:
                full_text += "\n\n--- Tables ---\n" + "\n".join(table_text)
            
            summary = self._generate_summary(full_text, "Document Word")
            tags = self._detect_tags(full_text, ["docx", "word"])
            return {"summary": summary, "text": full_text[:30000], "tags": tags}
        except ImportError:
            return {"summary": "python-docx not installed. Run: pip install python-docx", "text": "", "tags": ["docx"]}
    
    async def _analyze_xlsx(self, path: Path) -> dict:
        """Extract text from XLSX"""
        try:
            import openpyxl
            wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
            all_text = []
            for sheet_name in wb.sheetnames:
                ws = wb[sheet_name]
                all_text.append(f"## {sheet_name}")
                for row in ws.iter_rows(values_only=True):
                    row_str = " | ".join(str(cell) if cell is not None else "" for cell in row)
                    if row_str.strip():
                        all_text.append(row_str)
            wb.close()
            full_text = "\n".join(all_text)
            
            summary = self._generate_summary(full_text, "Tableur Excel")
            tags = self._detect_tags(full_text, ["xlsx", "excel", "spreadsheet"])
            return {"summary": summary, "text": full_text[:30000], "tags": tags}
        except ImportError:
            return {"summary": "openpyxl not installed. Run: pip install openpyxl", "text": "", "tags": ["xlsx"]}
    
    async def _analyze_csv(self, path: Path) -> dict:
        """Extract text from CSV"""
        import csv
        rows = []
        with open(str(path), "r", encoding="utf-8", errors="replace") as f:
            reader = csv.reader(f)
            for i, row in enumerate(reader):
                rows.append(" | ".join(row))
                if i > 500:  # Limit
                    rows.append("... (truncated)")
                    break
        full_text = "\n".join(rows)
        summary = self._generate_summary(full_text, "Fichier CSV")
        tags = self._detect_tags(full_text, ["csv", "data"])
        return {"summary": summary, "text": full_text[:30000], "tags": tags}
    
    async def _analyze_image(self, path: Path) -> dict:
        """Analyze image — basic info + OCR if available"""
        try:
            from PIL import Image
            img = Image.open(str(path))
            info = f"Image: {img.size[0]}x{img.size[1]} pixels, format: {img.mode}"
            
            # Try OCR with pytesseract if available
            try:
                import pytesseract
                text = pytesseract.image_to_string(img, lang="fra+eng")
                if text.strip():
                    summary = self._generate_summary(text, "Image (OCR)")
                    return {"summary": summary, "text": text[:10000], "tags": ["image", "ocr"]}
            except (ImportError, Exception):
                pass
            
            return {"summary": info, "text": info, "tags": ["image"]}
        except ImportError:
            return {"summary": "Pillow not installed", "text": "", "tags": ["image"]}
    
    async def _analyze_text(self, path: Path) -> dict:
        """Read plain text / markdown"""
        with open(str(path), "r", encoding="utf-8", errors="replace") as f:
            full_text = f.read()
        summary = self._generate_summary(full_text, "Fichier texte")
        tags = self._detect_tags(full_text, ["text"])
        return {"summary": summary, "text": full_text[:30000], "tags": tags}
    
    def _generate_summary(self, text: str, doc_type: str) -> str:
        """Generate a basic summary (rule-based, no LLM needed for basic)"""
        if not text.strip():
            return f"{doc_type} — fichier vide"
        
        lines = [l for l in text.split("\n") if l.strip()]
        word_count = len(text.split())
        char_count = len(text)
        
        # Get first meaningful lines
        preview_lines = lines[:5]
        preview = " / ".join(preview_lines[:3])[:200]
        
        summary_parts = [f"{doc_type} — {word_count} mots, {char_count} caractères"]
        if preview:
            summary_parts.append(f"Aperçu: {preview}")
        
        return ". ".join(summary_parts)
    
    def _detect_tags(self, text: str, base_tags: list) -> list:
        """Auto-detect tags from content"""
        tags = list(base_tags)
        text_lower = text.lower()
        
        # Financial
        if any(w in text_lower for w in ["facture", "€", "ht", "ttc", "tva", "paiement", "montant"]):
            tags.append("financier")
        
        # Legal
        if any(w in text_lower for w in ["contrat", "clause", "avocat", "tribunal", "jugement", "affaire"]):
            tags.append("juridique")
        
        # Medical
        if any(w in text_lower for w in ["patient", "diagnostic", "traitement", "ordonnance", "clinique"]):
            tags.append("médical")
        
        # Personal
        if any(w in text_lower for w in ["cher", "bonjour", "cordialement", "salutations"]):
            tags.append("correspondance")
        
        # Technical
        if any(w in text_lower for w in ["code", "api", "serveur", "database", "sql", "python"]):
            tags.append("technique")
        
        return list(set(tags))
