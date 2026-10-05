# YouTube Loop Player

YouTube videolarında A–B aralığını belirlenen sayıda tekrar oynatan küçük bir PWA.

## İlk sürüm
- YouTube bağlantısı / video kimliği
- A ve B noktalarını videonun mevcut anından alma
- ±1 saniye düzeltme
- tekrar sayısı
- oynatma hızı
- tekrarlar arası bekleme
- kayıtlı bölümler
- son videolar
- PWA desteği

## Yerelde çalıştırma
```bash
python3 -m http.server 8080
```
Sonra `http://localhost:8080` adresini aç.

> Not: Uygulama arayüzü PWA ile cache'lenebilir, fakat YouTube videosunun kendisi çevrimdışı oynatılmaz.
