'use strict';
// Okno dostane jen čtení zdroje a uložení vlastního pohledu. Žádný přístup
// k souborům.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('labAPI', {
  getState: () => ipcRenderer.invoke('lab:getState'),
  listJournals: () => ipcRenderer.invoke('source:list'),
  readJournal: id => ipcRenderer.invoke('source:read', id),
  saveViews: views => ipcRenderer.invoke('views:set', views),
  chooseSourceDir: () => ipcRenderer.invoke('source:choose'),
  // Automatické aktualizace (stejné názvy jako Futures Journal PRO).
  getUpdateState: () => ipcRenderer.invoke('update:getState'),
  checkForUpdates: options => ipcRenderer.invoke('update:check', options),
  downloadUpdate: () => ipcRenderer.invoke('update:download'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  onUpdateState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('update:state', listener);
    return () => ipcRenderer.removeListener('update:state', listener);
  },
  onSourceChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('source:changed', listener);
    return () => ipcRenderer.removeListener('source:changed', listener);
  }
});
