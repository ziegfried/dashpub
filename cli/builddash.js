/*
Copyright 2020 Splunk Inc. 

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

const { loadDashboard } = require('./splunkd');
const { downloadImage } = require('./assets');
const { generateCdnDataSources } = require('./datafns');
const { writeFile, mkdirp, remove } = require('fs-extra');
const { cli } = require('cli-ux');
const path = require('path');

const COMPONENT_CODE = `\
import React, { lazy, Suspense } from 'react';
import Loading from '../../components/loading';
import NoSSR from '../../components/nossr';
import definition from './definition.json';

const Dashboard = lazy(() => import('../../components/dashboard'));

export default function () {
    return (
        <NoSSR>
            <Suspense fallback={<Loading />}>
                <Dashboard definition={definition} />
            </Suspense>
        </NoSSR>
    );
}
`;

async function generateDashboard({ name, targetName = name, app, projectFolder }, splunkdInfo) {
    const dash = await loadDashboard(name, app, splunkdInfo);
    const [dsManifest, newDash] = await generateCdnDataSources(dash, projectFolder);
    for (const viz of Object.values(newDash.visualizations || {})) {
        try {
            if (viz.type === 'viz.singlevalueicon') {
                viz.options.icon = await downloadImage(viz.options.icon, 'icons', 'splunk-dashboard-studio', splunkdInfo, projectFolder);
            }
            if (viz.type === 'viz.img') {
                viz.options.src = await downloadImage(viz.options.src, 'images', 'splunk-dashboard-studio', splunkdInfo, projectFolder);
            }
        } catch (e) {
            console.error(`Failed to download image ${viz.options.icon || viz.options.src}`, e);
        }
    }

    if (newDash.layout.options.backgroundImage) {
        newDash.layout.options.backgroundImage.src = await downloadImage(
            newDash.layout.options.backgroundImage.src,
            'images',
            'splunk-dashboard-studio',
            splunkdInfo,
            projectFolder
        );
    }

    const dir = path.join(projectFolder, 'src/dashboards', targetName);
    await mkdirp(dir);
    await writeFile(path.join(dir, 'definition.json'), Buffer.from(JSON.stringify(newDash, null, 2), 'utf-8'));
    await writeFile(path.join(dir, 'index.js'), COMPONENT_CODE, 'utf-8');

    return [dsManifest, { [name]: newDash.title }];
}

async function generate(app, dashboards, splunkdInfo, projectFolder) {
    console.log(`Generating ${dashboards.length} dashboards...`);
    // cleanup
    await remove(path.join(projectFolder, 'public/assets'));
    await remove(path.join(projectFolder, 'src/pages/api/data/_datasources.json'));
    await remove(path.join(projectFolder, 'src/dashboards'));

    // create required dirs
    await mkdirp(path.join(projectFolder, 'public/assets'));
    await mkdirp(path.join(projectFolder, 'src/pages/api/data'));

    let datasourcesManifest = {};
    let dashboardsManifest = {};

    for (const dashboard of dashboards) {
        const targetName = dashboard;
        cli.action.start(`Generating dashboard ${dashboard}`);
        const [dsManifest, dashboardInfo] = await generateDashboard(
            {
                name: dashboard,
                targetName,
                app,
                projectFolder,
            },
            splunkdInfo
        );

        datasourcesManifest = Object.assign(datasourcesManifest, dsManifest);
        Object.assign(dashboardsManifest, dashboardInfo);
        cli.action.stop();
    }

    cli.action.start('Writing manifest files...');
    await writeFile(path.join(projectFolder, 'src/pages/api/data/_datasources.json'), JSON.stringify(datasourcesManifest, null, 4), {
        encoding: 'utf-8',
    });
    await writeFile(path.join(projectFolder, 'src/_dashboards.json'), JSON.stringify(dashboardsManifest, null, 4), {
        encoding: 'utf-8',
    });
    cli.action.stop();
}

module.exports = {
    generate,
};
