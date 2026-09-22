# Sidebar principal — foco em sugestões

## Princípio

A sidebar é uma ferramenta de conversa, não uma tela de configuração.

```text
uso frequente -> visível
configuração eventual -> recolhida
```

## Hierarquia

```text
Contato
Sugestões
Sugerir mensagem
Tradução
Resumo
Prompts
```

Sugestões e Sugerir mensagem permanecem abertas. Tradução, Resumo e Prompts iniciam compactos.

## Tradução

Desligada:

```text
🌐 Tradução      Desativada   ☐
```

Ligada/recolhida:

```text
🌐 Tradução      Português → Inglês   ☑ ▾
```

Ligada/expandida mostra seletores e ações manuais.

## Resumo

Recolhido:

```text
📝 Resumo      ✓ Atualizado ▾
📝 Resumo      +4 novas     ▾
📝 Resumo      Não criado   ▾
```

O conteúdo completo aparece somente ao expandir. Modo, frequência e limpeza de histórico ficam em **Configurações do resumo**, um segundo nível recolhível.

## Prompts

Recolhido:

```text
✨ Prompts      2 auto • 1 aqui ▾
```

A lista e os botões de administração são montados somente quando a seção está aberta.

## Persistência visual

`expandedSections` fica no objeto `SidebarUI`. Como o DOM é recriado em todo `render()`, nunca se usa o DOM como fonte de verdade para expansão.

## Correção do null

Elementos condicionais não são passados diretamente como `null` a `append()`. `appendPresent()` filtra valores ausentes e condições mais complexas são adicionadas com `if`.

## Mobile

As mesmas seções começam recolhidas, permitindo que sugestões e Sugerir mensagem apareçam antes das configurações mesmo em telas estreitas.
