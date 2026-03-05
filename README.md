# ⚡ WorkHub — Dashboard de Trabalho Diário

Dashboard moderno integrado com **Google Workspace**: Agenda por turnos, Tarefas, Gmail, Google Keep, To-Do persistido no Google Drive e importação de horários semanais via CSV, PDF ou imagem.

---

## 🌐 Deploy (GitHub Pages — HTTPS, sem localhost)

```bash
chmod +x deploy.sh
./deploy.sh workhub-dashboard
```

Após o deploy, configure no [Google Cloud Console](https://console.cloud.google.com):
- **Origens JS Autorizadas**: `https://SEU_USUARIO.github.io`
- **URIs de Redirecionamento**: `https://SEU_USUARIO.github.io/workhub-dashboard/`

---

## ⚙️ Configuração

Edite `config.js` e substitua o CLIENT_ID:
```js
CLIENT_ID: 'SEU_CLIENT_ID.apps.googleusercontent.com',
```

## APIs necessárias (Google Cloud Console → Biblioteca de APIs)

| API | Uso |
|---|---|
| Google Calendar API | Agenda por turnos + importação semanal |
| Google Tasks API | Lista de tarefas |
| Gmail API | Preview de emails |
| Google Drive API | Banco de dados (planilha) |
| Google Sheets API | CRUD de dados |

---

## 📅 Importar Horários

Clique em **📅 Importar Horário** na barra superior.

### Formatos aceitos

**Grade semanal (formato escola/professor):**
```
DIEGO
Hor    Seg                 Ter          Qua                  Qui            Sex
07:30
08:00                                   3° C (MAT)/FIS 3
10:20  2° C (MAT)/ROBOTI               2° C (MAT)/ROBOTI                   2° GT/TEINTU
11:10  1° IA/PROMPT                    1° IA/TEC. I         1° IA/INOVAC   1° IA/INOVAC
11:55  1° IA/INOVAC        1° IA/TEC.  2° GT/TEINTU         3° C (MAT)/FIS 3
```

**CSV (ponto-e-vírgula ou vírgula):**
```
Dia;Início;Fim;Matéria;Local
Segunda;08:00;09:00;Matemática;Sala 1
Terça;14:00;15:30;Física;Lab
```

**Arquivo / Imagem:**
- `.pdf` → extração de texto automática (PDF.js)
- `.png`, `.jpg`, `.webp` → OCR automático (Tesseract.js, português + inglês)

Clique **Agendar Semanalmente** → eventos criados no Google Calendar com recorrência semanal (`RRULE:FREQ=WEEKLY`).

---

## 🔐 Login Persistente

O token Google é armazenado no `localStorage` com renovação automática 5 minutos antes da expiração. O usuário permanece conectado sem fazer login novamente.

---

## 📁 Estrutura de Arquivos

| Arquivo | Função |
|---|---|
| `index.html` | HTML — modal + layout 3 colunas |
| `style.css` | Tema Black/Yellow glassmorphism |
| `config.js` | CLIENT_ID, demo data, configurações |
| `drive.js` | Google Drive/Sheets CRUD (banco de dados) |
| `schedule.js` | Parser CSV/Grade/PDF/OCR + Google Calendar |
| `app.js` | Auth persistente + lógica principal |
| `deploy.sh` | Script de deploy para GitHub Pages |
| `.nojekyll` | Fix GitHub Pages (evita Jekyll) |
