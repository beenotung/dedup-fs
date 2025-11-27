# Block Size Impact on Deduplication Performance

This document presents experimental results analyzing how block size affects deduplication efficiency.

## Key Findings

The block size doesn't significantly affect the deduplication ratio. While larger blocks may slightly reduce deduplication efficiency, the difference is minimal for most use cases.

## Text-based Data

data: github.com/beenotung/tslib (including both source, built js file, and node_modules)

total_size: 624,806,286 bytes

### Results

| block size\* | storage size\* | # block reuse | saved (bytes) | saved % |
| ------------ | -------------- | ------------- | ------------- | ------- |
| 32           | 133,716,883    | 15,369,412    | 491,089,403   | 78.60%  |
| 64           | 149,146,410    | 7,455,009     | 475,659,876   | 76.13%  |
| 128          | 152,882,255    | 3,709,489     | 471,924,031   | 75.53%  |
| 256          | 154,135,096    | 1,861,269     | 470,671,190   | 75.33%  |
| 512          | 154,771,601    | 941,809       | 470,034,685   | 75.23%  |
| 1,024        | 155,365,444    | 483,353       | 469,440,842   | 75.13%  |
| 2,048        | 155,835,717    | 256,208       | 468,970,569   | 75.06%  |
| 4,096        | 156,015,582    | 146,666       | 468,790,704   | 75.03%  |
| 8,192        | 156,167,190    | 93,234        | 468,639,096   | 75.01%  |
| 16,384       | 156,281,878    | 67,585        | 468,524,408   | 74.99%  |
| 32,768       | 156,331,030    | 55,339        | 468,475,256   | 74.98%  |
| 65,536       | 156,429,334    | 49,467        | 468,376,952   | 74.96%  |
| 131,072      | 156,757,014    | 46,727        | 468,049,272   | 74.91%  |
| 262,144      | 157,019,158    | 45,461        | 467,787,128   | 74.87%  |
| 1,048,576    | 157,805,590    | 44,584        | 467,000,696   | 74.74%  |
| 4,194,304    | 160,951,318    | 44,420        | 463,854,968   | 74.24%  |
| 10,485,760   | 158,854,166    | 44,386        | 465,952,120   | 74.58%  |

## Binary Data

data: backup app images of various versions of cursor (IDE forked from VSCode)

total_size: 2,822,251,957 bytes

| block size\* | storage size\* | # block reuse | saved (bytes) | saved % |
| ------------ | -------------- | ------------- | ------------- | ------- |
| 256          | 2,065,689,333  | 2,955,325     | 756,562,624   | 26.81%  |
| 512          | 2,066,646,261  | 1,475,798     | 755,605,696   | 26.77%  |
| 1,024        | 2,069,388,021  | 735,226       | 752,863,936   | 26.68%  |
| 2,048        | 2,069,908,597  | 367,358       | 752,343,360   | 26.66%  |
| 4,096        | 2,070,078,581  | 183,641       | 752,173,376   | 26.65%  |
| 8,192        | 2,070,413,557  | 91,778        | 751,838,400   | 26.64%  |
| 16,384       | 2,070,569,205  | 45,880        | 751,682,752   | 26.63%  |
| 32,768       | 2,070,847,733  | 22,932        | 751,404,224   | 26.62%  |
| 65,536       | 2,071,602,613  | 11,454        | 750,649,344   | 26.60%  |
| 131,072      | 2,072,782,261  | 5,718         | 749,469,696   | 26.56%  |
| 262,144      | 2,074,617,269  | 2,852         | 747,634,688   | 26.49%  |
| 1,048,576    | 2,087,200,181  | 701           | 735,051,776   | 26.04%  |
| 4,194,304    | 2,125,997,493  | 166           | 696,254,464   | 24.67%  |
| 10,485,760   | 2,182,620,597  | 61            | 639,631,360   | 22.66%  |

## Remarks

\* The unit for storage size and saved size is bytes.

While deduplication ratio is important, other factors such as block metadata overhead, read performance, and memory usage should also be considered when choosing a block size.

## On Using Small Block Size

Block size below 256 bytes are also tested, but it runs much slower and caused `JavaScript heap out of memory` error on the binary data test.
