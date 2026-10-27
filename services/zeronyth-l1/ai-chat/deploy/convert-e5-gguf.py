# multilingual-e5-small is a BertModel with an XLM-R sentencepiece tokenizer and BERT-style positions (no offset).
import sys, runpy
sys.path[:0] = ['/workspace/ai-train/conv/lc', '/workspace/ai-train/conv/lc/gguf-py']
import conversion.bert as cb
def set_vocab(self):
    self._position_offset = None
    self._xlmroberta_set_vocab()
cb.BertModel.set_vocab = set_vocab
sys.argv = ['convert_hf_to_gguf.py', *sys.argv[1:]]
runpy.run_path('/workspace/ai-train/conv/lc/convert_hf_to_gguf.py', run_name='__main__')
