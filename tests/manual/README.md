# Manual screenshot scripts

## Before capture (required for multi-cloud UI)

```powershell
cd ..\backend
node dev/issue-enterprise-license.cjs --activate
```

Then refresh the browser session and run:

```powershell
cd tests
npm run manual:shots:pool
npm run manual:shots:images
```

See ../docs/cloudmap/user-manual/SCREENSHOTS.md