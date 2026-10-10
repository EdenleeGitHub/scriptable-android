window.__runWidget = async function(script,parameter,family,widgetId) {
  try {
    await Host.ready;
    await ScriptRunner.run(script,{}, {widgetParameter:parameter || null,config:{runsInWidget:true,runsInApp:false,widgetFamily:family || 'medium',widgetId}});
    Android.widgetDone(JSON.stringify({ok:true}));
  } catch(error) { Android.widgetDone(JSON.stringify({ok:false,error:String(error.message || error)})); }
};
