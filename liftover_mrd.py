"""Lift Signatera variant positions from hs37d5/GRCh37 (hg19) to GRCh38, keeping both.

    python3 liftover_mrd.py            # chain-file liftover only (nothing leaves this Mac)
    python3 liftover_mrd.py --ensembl --genes  # also cross-check with rest.ensembl.org and add genes (VEP)
                                       # (sends only chromosome + position, no names)

Reads  local/mrd_alleles.tsv  (one row per draw x variant, positions as Natera sent them)
Writes local/mrd_variants.tsv (one row per variant: GRCh37 and GRCh38 position, checks)

Chain file: local/liftover/hg19ToHg38.over.chain.gz from
https://hgdownload.soe.ucsc.edu/goldenPath/hg19/liftOver/ (0-based, half-open blocks).
Natera positions are treated as 1-based (VCF style); the Ensembl ref-base check confirms it.
"""
import csv, gzip, json, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
CHAIN = HERE / 'local/liftover/hg19ToHg38.over.chain.gz'
IN, OUT = HERE / 'local/mrd_alleles.tsv', HERE / 'local/mrd_variants.tsv'


def load_chains(wanted):
    """Return {chrom: [(tStart, tEnd, qName, qStrand, qSize, qStart, score), blocks...]} for wanted chroms."""
    chains, cur = {}, None
    with gzip.open(CHAIN, 'rt') as f:
        for line in f:
            p = line.split()
            if not p:
                continue
            if p[0] == 'chain':
                score, tName, tStart = int(p[1]), p[2], int(p[5])
                qName, qSize, qStrand, qStart = p[7], int(p[8]), p[9], int(p[10])
                cur = None
                if tName in wanted:
                    cur = dict(score=score, qName=qName, qSize=qSize, qStrand=qStrand, blocks=[], t=tStart, q=qStart)
                    chains.setdefault(tName, []).append(cur)
            elif cur is not None:
                size = int(p[0])
                cur['blocks'].append((cur['t'], cur['q'], size))
                if len(p) == 3:
                    cur['t'] += size + int(p[1]); cur['q'] += size + int(p[2])
    return chains


def lift(chains, chrom, pos1):
    """1-based position -> list of (chrom, 1-based pos, strand, chain score)."""
    x = pos1 - 1
    hits = []
    for c in chains.get(chrom, []):
        for t, q, size in c['blocks']:
            if t <= x < t + size:
                y = q + (x - t)
                if c['qStrand'] == '-':
                    y = c['qSize'] - 1 - y
                hits.append((c['qName'], y + 1, c['qStrand'], c['score']))
                break
    return sorted(hits, key=lambda h: -h[3])


def ensembl(path, host='https://rest.ensembl.org'):
    req = urllib.request.Request(host + path, headers={'Content-Type': 'application/json', 'User-Agent': 'liftover-check'})
    for _ in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return json.load(r)
        except Exception as e:
            err = e; time.sleep(1)
    raise err


def main():
    use_ens = '--ensembl' in sys.argv
    rows = list(csv.DictReader(open(IN), delimiter='\t'))
    variants = {}
    for r in rows:
        variants.setdefault(r['target_id'], r)
    chains = load_chains({r['chrom'] for r in variants.values()})
    out = []
    for tid in sorted(variants, key=lambda t: int(t.split('_')[1])):
        r = variants[tid]
        pos = int(r['position'])
        hits = lift(chains, r['chrom'], pos)
        o = dict(target_id=tid, chrom=r['chrom'], pos_grch37=pos, ref=r['ref'], alt=r['alt'], change_type=r['change_type'],
                 chrom_grch38=hits[0][0] if hits else '', pos_grch38=hits[0][1] if hits else '',
                 strand_grch38=hits[0][2] if hits else '', liftover='ok' if len(hits) == 1 else ('none' if not hits else f'{len(hits)} hits, best chain used'),
                 ref_grch37_ensembl='', ref_grch38_ensembl='', pos_grch38_ensembl='', check='')
        if use_ens and hits:
            c = r['chrom'].removeprefix('chr')
            # GRCh37 sequence is served by the grch37 mirror; GRCh38 and the assembly map by the main server
            s37 = ensembl(f'/sequence/region/human/{c}:{pos}..{pos}:1', host='https://grch37.rest.ensembl.org')['seq']
            s38 = ensembl(f'/sequence/region/human/{o["chrom_grch38"].removeprefix("chr")}:{o["pos_grch38"]}..{o["pos_grch38"]}:1')['seq']
            m = ensembl(f'/map/human/GRCh37/{c}:{pos}..{pos}:1/GRCh38')['mappings']
            e38 = m[0]['mapped']['start'] if len(m) == 1 else ''
            o.update(ref_grch37_ensembl=s37, ref_grch38_ensembl=s38, pos_grch38_ensembl=e38)
            problems = []
            if s37.upper() != r['ref'].upper(): problems.append('GRCh37 ref differs')
            if s38.upper() != r['ref'].upper(): problems.append('GRCh38 ref differs')
            if str(e38) != str(o['pos_grch38']): problems.append('Ensembl position differs')
            o['check'] = '; '.join(problems) or 'ok'
            time.sleep(0.2)
        if '--genes' in sys.argv and hits:
            # Ensembl VEP on GRCh38 (sends chromosome, position and the changed base only); one picked transcript per variant
            c38 = o['chrom_grch38'].removeprefix('chr')
            v = ensembl(f'/vep/human/region/{c38}:{o["pos_grch38"]}-{o["pos_grch38"]}:1/{r["alt"]}?hgvs=1&canonical=1&pick=1')[0]
            tc = (v.get('transcript_consequences') or [{}])[0]
            o.update(gene=tc.get('gene_symbol', ''), gene_id=tc.get('gene_id', ''), biotype=tc.get('biotype', ''),
                     consequence=v.get('most_severe_consequence', ''), impact=tc.get('impact', ''),
                     hgvsc=tc.get('hgvsc', ''), hgvsp=tc.get('hgvsp', ''), protein_change=tc.get('amino_acids', ''),
                     transcript_canonical='yes' if tc.get('canonical') else '')
            time.sleep(0.2)
        out.append(o)
    w = csv.DictWriter(open(OUT, 'w'), fieldnames=list(out[0]), delimiter='\t', lineterminator='\n')
    w.writeheader(); w.writerows(out)
    for o in out:
        print(o['target_id'], o['chrom'], o['pos_grch37'], '->', o['chrom_grch38'], o['pos_grch38'], o['strand_grch38'], o['liftover'], o['check'])


if __name__ == '__main__':
    main()
