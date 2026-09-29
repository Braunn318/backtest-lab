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
  onSourceChanged: callback => {
    const listener = () => callback();
    ipcRenderer.on('source:changed', listener);
    return () => ipcRenderer.removeListener('source:changed', listener);
  }
});
