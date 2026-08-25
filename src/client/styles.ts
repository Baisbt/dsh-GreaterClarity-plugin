/** 主题 token + data-* 锚点样式（随插件生命周期注入/移除）。 */
export const STYLES = `
.dsh-gc-btns{display:inline-flex;gap:6px;align-items:center}
.dsh-gc-btn{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:6px;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  color:var(--dsw-alias-label-primary,#ddd);font-size:12px;line-height:1.4;cursor:pointer;white-space:nowrap}
.dsh-gc-btn:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-btn[aria-pressed="true"]{background:var(--dsw-alias-brand-primary,#4a9eff);color:var(--dsw-alias-label-primary-foreground,#fff);border-color:transparent}
.dsh-gc-btn:disabled{opacity:.45;cursor:not-allowed}
[data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]{position:relative}
.dsh-gc-avatarwrap{position:absolute;top:100%;right:calc(100% + 8px);display:flex;flex-direction:column;align-items:center;gap:2px;z-index:1}
.dsh-gc-avatar{display:block;border-radius:50%;object-fit:cover;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1,#555);box-shadow:0 1px 3px rgba(0,0,0,.2)}
.dsh-gc-round{font-size:10px;line-height:1.3;padding:1px 6px;border-radius:8px;white-space:nowrap;cursor:default;user-select:none;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-secondary,#bbb);border:1px solid var(--dsw-alias-border-l1,#555)}
@container (max-width:900px){
  .dsh-gc-avatarwrap{position:static;float:left;margin:2px 8px 4px 0}
}
[data-dsh-gc-hidden]{display:none !important}
[data-dsh-gc-folded] [data-variant="think"]{display:none !important}
.dsh-gc-modal-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:99990;
  display:flex;align-items:center;justify-content:center}
.dsh-gc-modal{width:560px;max-width:92vw;max-height:80vh;display:flex;flex-direction:column;
  background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l2,#333);
  border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.3);overflow:hidden;color:var(--dsw-alias-label-primary,#222)}
.dsh-gc-modal-head{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;
  border-bottom:1px solid var(--dsw-alias-border-l1,#555);font-size:14px;font-weight:600}
.dsh-gc-close{border:none;background:transparent;color:var(--dsw-alias-label-secondary,#888);
  font-size:22px;line-height:1;cursor:pointer;padding:0 4px}
.dsh-gc-close:hover{color:var(--dsw-alias-label-primary,#222)}
.dsh-gc-modal-body{display:flex;flex:1;min-height:0}
.dsh-gc-modal-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 16px;
  border-top:1px solid var(--dsw-alias-border-l1,#555)}
.dsh-gc-danger{padding:5px 12px;border-radius:6px;border:1px solid var(--dsw-alias-state-error-primary,#e05252);
  background:transparent;color:var(--dsw-alias-state-error-primary,#e05252);cursor:pointer;font-size:12px;white-space:nowrap}
.dsh-gc-danger:hover{background:var(--dsw-alias-state-error-primary,#e05252);color:#fff}
.dsh-gc-nav{width:150px;flex:none;border-right:1px solid var(--dsw-alias-border-l1,#555);padding:8px}
.dsh-gc-nav-item{display:block;width:100%;text-align:left;padding:8px 10px;margin-bottom:4px;border:none;
  border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#777);font-size:13px;cursor:pointer}
.dsh-gc-nav-item:hover{background:var(--dsw-alias-bg-layer-1,#eee)}
.dsh-gc-nav-item.active{background:var(--dsw-alias-bg-layer-1,#eee);color:var(--dsw-alias-label-primary,#222);font-weight:600}
.dsh-gc-content{flex:1;min-width:0;padding:14px 16px;overflow:auto;font-size:13px}
.dsh-gc-row{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 0;
  border-bottom:1px solid var(--dsw-alias-border-l1,#555)}
.dsh-gc-row:last-child{border-bottom:none}
.dsh-gc-label{color:var(--dsw-alias-label-primary,#222)}
.dsh-gc-hint{color:var(--dsw-alias-label-secondary,#888);font-size:12px;margin-top:2px}
.dsh-gc-toggle{position:relative;width:38px;height:22px;flex:none;cursor:pointer}
.dsh-gc-toggle input{opacity:0;width:0;height:0}
.dsh-gc-toggle .track{position:absolute;inset:0;border-radius:11px;
  background:var(--dsw-alias-label-tertiary,#8a8a8a);border:1px solid var(--dsw-alias-border-l1,#666);
  transition:background .16s}
.dsh-gc-toggle .track::after{content:"";position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;
  background:var(--dsw-alias-bg-overlay,#f2f2f2);transition:left .16s;box-shadow:0 1px 3px rgba(0,0,0,.35)}
.dsh-gc-toggle input:checked + .track{background:var(--dsw-alias-brand-primary,#4a9eff);border-color:transparent}
.dsh-gc-toggle input:checked + .track::after{left:18px}
.dsh-gc-toggle input:focus-visible + .track{outline:2px solid var(--dsw-alias-brand-primary,#4a9eff);outline-offset:2px}
.dsh-gc-range{width:110px;accent-color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-num{width:64px;background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#ddd);
  border:1px solid var(--dsw-alias-border-l1,#555);border-radius:6px;padding:4px 8px;font-size:12px;text-align:right}
.dsh-gc-size-val{min-width:52px;text-align:right;color:var(--dsw-alias-label-secondary,#888)}
.dsh-gc-upload-btn{display:inline-block;padding:5px 10px;border-radius:6px;border:1px solid var(--dsw-alias-border-l1,#555);
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#ddd);cursor:pointer;font-size:12px}
.dsh-gc-history{position:fixed;z-index:99980;width:300px;max-width:calc(100vw - 16px);max-height:60vh;
  display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay,#fff);
  border:1px solid var(--dsw-alias-border-l2,#333);border-radius:10px;
  box-shadow:0 8px 28px rgba(0,0,0,.3);overflow:hidden;color:var(--dsw-alias-label-primary,#222);font-size:12px}
.dsh-gc-history-topbar{flex:none;display:flex;align-items:center;gap:8px;padding:8px 8px 0}
.dsh-gc-top-btn{flex:1;min-width:0;padding:6px;border-radius:6px;font-size:12px;cursor:pointer;
  border:1px solid var(--dsw-alias-border-l1,#555);background:var(--dsw-alias-bg-layer-1,#1e1e1e);
  color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-top-btn:hover{border-color:var(--dsw-alias-brand-primary,#4a9eff)}
.dsh-gc-history-hint{flex:none;font-size:11px;color:var(--dsw-alias-state-error-primary,#e05252);white-space:nowrap}
.dsh-gc-hist-no{display:inline-block;margin-right:6px;padding:1px 6px;border-radius:6px;text-align:center;
  background:var(--dsw-alias-button-info-fill,#4a9eff);color:#fff;font-weight:600}
.dsh-gc-history-search{flex:none;margin:8px 8px 4px;padding:6px 10px;border-radius:6px;
  background:var(--dsw-alias-bg-layer-1,#1e1e1e);color:var(--dsw-alias-label-primary,#ddd);
  border:1px solid var(--dsw-alias-border-l1,#555);font-size:12px}
.dsh-gc-history-list{flex:1;min-height:0;overflow-y:auto;padding:0 4px 8px}
.dsh-gc-history-item{padding:6px 8px;border-radius:6px;cursor:pointer;
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dsh-gc-history-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.06))}
.dsh-gc-history-empty{padding:12px 8px;color:var(--dsw-alias-label-secondary,#888)}
`
