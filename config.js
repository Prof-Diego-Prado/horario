// ============================================================
//  WORK DASHBOARD — Google Workspace Configuration
//  Preencha CLIENT_ID com seu client_id do Google Cloud Console
//  https://console.cloud.google.com/apis/credentials
// ============================================================

const CONFIG = {
    CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID_HERE', // ← substitua pelo seu client_id

    // Scopes necessários para as APIs
    SCOPES: [
        // Google Workspace
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/keep.readonly',
        // Google Drive / Sheets (banco de dados)
        'https://www.googleapis.com/auth/drive.file',        // Acesso apenas a arquivos criados pelo app
        'https://www.googleapis.com/auth/spreadsheets',      // Leitura e escrita na planilha
    ].join(' '),

    // Nome da planilha criada no Drive do usuário
    DB_SHEET_NAME: 'WorkDashboard',

    // Turnos do dia
    SHIFTS: {
        morning: { label: '🌅 Manhã', start: 6, end: 12, color: '#f59e0b' },
        afternoon: { label: '☀️ Tarde', start: 12, end: 18, color: '#06b6d4' },
        night: { label: '🌙 Noite', start: 18, end: 24, color: '#8b5cf6' },
    },

    // Modo demo — dados fictícios quando não há autenticação
    DEMO_EVENTS: [
        { id: 'd1', title: 'Stand-up da Equipe', start: '09:00', end: '09:30', shift: 'morning', color: '#06b6d4' },
        { id: 'd2', title: 'Reunião com o Cliente', start: '10:00', end: '11:00', shift: 'morning', color: '#f59e0b' },
        { id: 'd3', title: 'Code Review', start: '11:30', end: '12:00', shift: 'morning', color: '#10b981' },
        { id: 'd4', title: 'Almoço + Review de Metas', start: '12:30', end: '13:30', shift: 'afternoon', color: '#f59e0b' },
        { id: 'd5', title: 'Sprint Planning', start: '14:00', end: '15:30', shift: 'afternoon', color: '#8b5cf6' },
        { id: 'd6', title: 'Deploy Produção', start: '16:00', end: '17:00', shift: 'afternoon', color: '#ef4444' },
        { id: 'd7', title: 'Retrospectiva', start: '19:00', end: '20:00', shift: 'night', color: '#06b6d4' },
    ],

    DEMO_TASKS: [
        { id: 't1', title: 'Revisar PRs pendentes', done: false },
        { id: 't2', title: 'Atualizar documentação da API', done: false },
        { id: 't3', title: 'Enviar relatório semanal', done: true },
        { id: 't4', title: 'Configurar pipeline CI/CD', done: false },
        { id: 't5', title: 'Testar nova funcionalidade', done: false },
    ],

    DEMO_EMAILS: [
        { from: 'gerente@empresa.com', subject: 'Aprovação do orçamento Q1', time: '08:15', read: false },
        { from: 'rh@empresa.com', subject: 'Lembrete: avaliação de desempenho', time: '07:30', read: false },
        { from: 'ti@empresa.com', subject: 'Manutenção programada sábado', time: '06:45', read: true },
        { from: 'cliente@parceiro.com', subject: 'Feedback sprint 12', time: '09:00', read: false },
        { from: 'noreply@github.com', subject: '[PR #247] Merge aprovado', time: '08:50', read: true },
    ],

    DEMO_NOTES: [
        { title: '📌 Ideias para o produto', body: 'Adicionar dark mode, integrar IA, melhorar onboarding...' },
        { title: '🔐 Config importante', body: 'Redis: porta 6379 | DB staging: postgresql://...' },
        { title: '📚 Leitura da semana', body: 'Clean Architecture cap. 15-18 + artigo sobre CQRS' },
    ],
};
